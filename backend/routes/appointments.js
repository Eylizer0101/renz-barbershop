// Scheduled bookings are separate from the same-day walk-in queue.
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { toObjectId, cleanText } = require('../utils/validation');
const { sendAppointmentEmail } = require('../utils/mailer');
const { audit } = require('../utils/security');
const router = express.Router();
const customerOnly = [requireAuth, requireRole('customer')];
const staffOnly = [requireAuth, requireRole('admin', 'cashier')];
const METHODS = ['cash', 'gcash', 'other'];
const minutes = d => new Date(d).getTime();
const ACTIVE_BOOKINGS = ['pending', 'confirmed', 'checked-in'];
const UPCOMING_BOOKINGS = ['pending', 'confirmed'];
const MAX_UPCOMING_BOOKINGS = 3;
// All times below are minutes after midnight in Philippine time.
const OPEN_MINUTE = 8 * 60;
const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;
const CLOSE_MINUTE = 19 * 60;
const INTERVAL_MINUTES = 25;
const MORNING_CAPACITY = 10; // Total across all barbers, not per barber.
function validStart(minute, duration) {
  return Number.isInteger(minute) && Number.isInteger(duration) && duration > 0 &&
    ((minute >= OPEN_MINUTE && minute < LUNCH_START && (minute - OPEN_MINUTE) % INTERVAL_MINUTES === 0 && minute + duration <= LUNCH_START) ||
     (minute >= LUNCH_END && minute < CLOSE_MINUTE && (minute - LUNCH_END) % INTERVAL_MINUTES === 0 && minute + duration <= CLOSE_MINUTE));
}
function appointmentError(message, status = 409) { const error = new Error(message); error.status = status; throw error; }
function morningRange(date) {
  return { start: new Date(`${date}T08:00:00+08:00`), end: new Date(`${date}T12:00:00+08:00`) };
}
async function morningCount(db, date, excludeId, session) {
  const { start, end } = morningRange(date);
  return db.collection('appointments').countDocuments({
    ...(excludeId ? {_id:{$ne:excludeId}} : {}),
    status: {$in:ACTIVE_BOOKINGS}, startsAt: {$gte:start,$lt:end}
  }, session ? {session} : {});
}
// A write on the same day's lock document serializes simultaneous morning bookings.
async function reserveMorningCapacity(db, date, excludeId, session) {
  await db.collection('bookingBatchLocks').updateOne({_id:date}, {$inc:{version:1}}, {upsert:true,session});
  if (await morningCount(db,date,excludeId,session) >= MORNING_CAPACITY)
    appointmentError('The morning batch is full (10 customers). Please choose an afternoon time or another date.');
}
function minuteOf(time) { return Number(time.slice(0,2))*60 + Number(time.slice(3,5)); }
function makeStartTimes(duration) {
  const starts=[];
  for (const [from,to] of [[OPEN_MINUTE,LUNCH_START],[LUNCH_END,CLOSE_MINUTE]]) {
    for (let minute=from;minute+duration<=to;minute+=INTERVAL_MINUTES) starts.push(minute);
  }
  return starts;
}
const manilaDateRange = date => {
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
};
// Preserve old single-service bookings while storing the selected services as snapshots.
const MAX_SERVICES_PER_BOOKING = 3;
function readServiceIds(body) {
  const raw = body?.serviceIds === undefined ? [body?.serviceId] : body.serviceIds;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_SERVICES_PER_BOOKING) return null;
  const ids = raw.map(toObjectId);
  if (ids.some(id => !id) || new Set(ids.map(String)).size !== ids.length) return null;
  return ids;
}
async function getSelectedServices(db, ids, session) {
  const entries = await db.collection('services').find({_id:{$in:ids}, active:{$ne:false}},session?{session}:{}).toArray();
  if (entries.length !== ids.length || entries.some(s=>!Number.isInteger(s.durationMinutes)||s.durationMinutes<=0||!Number.isFinite(s.price)||s.price<0)) return null;
  const byId = new Map(entries.map(s=>[String(s._id),s]));
  return ids.map(id=>byId.get(String(id)));
}
function serviceSnapshot(services) {
  const items=services.map(s=>({serviceId:s._id,name:s.name,price:s.price,durationMinutes:s.durationMinutes,imageUrl:s.imageUrl||''}));
  return {services:items,serviceId:services[0]._id,service:services.map(s=>s.name).join(' + '),price:Math.round(services.reduce((n,s)=>n+s.price,0)*100)/100,durationMinutes:services.reduce((n,s)=>n+s.durationMinutes,0),imageUrl:services[0].imageUrl||''};
}
const view = a => ({queueTicketId:a.queueTicketId?String(a.queueTicketId):null,id:String(a._id),customerName:a.customerName,service:a.service,serviceId:String(a.serviceId),serviceIds:(a.services?.length?a.services.map(s=>String(s.serviceId)):[String(a.serviceId)]),services:(a.services?.length?a.services.map(s=>({id:String(s.serviceId),name:s.name,price:s.price,durationMinutes:s.durationMinutes,imageUrl:s.imageUrl||""})):[{id:String(a.serviceId),name:a.service,price:a.price,durationMinutes:a.durationMinutes,imageUrl:a.imageUrl||""}]),barberId:String(a.barberId),barberName:a.barberName,price:a.price,durationMinutes:a.durationMinutes,startsAt:a.startsAt,endsAt:a.endsAt,method:a.method,imageUrl:a.imageUrl||"",status:a.status,createdAt:a.createdAt});

async function notify(db, a, type, title, message) {
  // Unique event keys prevent repeat emails/alerts for the same transition.
  const eventKey = `${a._id}:${type}`;
  try {
    await db.collection('appointmentNotifications').insertOne({eventKey,appointmentId:a._id,customerId:a.customerId,type,title,message,read:false,createdAt:new Date(),emailStatus:'pending',emailAttempts:0,staffReadBy:[]});
  } catch (err) { if (err.code === 11000) return; throw err; }
  // Notification is persisted before returning. SMTP must not hold up booking responses.
  // A pending notification is recoverable by the reminder worker after a restart.
  void (async () => {
    try {
      await sendAppointmentEmail(a.customerEmail,title,message,a);
      await db.collection('appointmentNotifications').updateOne({eventKey},{$set:{emailStatus:'sent',sentAt:new Date()}});
    } catch (err) {
      console.error('Appointment email failed:',err.message);
      try {
        await db.collection('appointmentNotifications').updateOne({eventKey},{$set:{emailStatus:'failed',nextEmailAttemptAt:new Date(Date.now()+60000)},$inc:{emailAttempts:1}});
      } catch (updateError) { console.error('Appointment email status update failed:',updateError.message); }
    }
  })();
}

// Live appointment queue detail; only the owner can access it. No fabricated
// "next" state: it follows the actual assigned barber and eligible queue order.
router.get('/live', ...customerOnly, async (req,res) => {
  const db=req.app.locals.db;
  const now=new Date();
  const a=await db.collection('appointments').find({customerId:req.user._id,status:{$in:['pending','confirmed','checked-in']},startsAt:{$gte:new Date(now.getTime()-12*3600000),$lte:new Date(now.getTime()+60*86400000)}}).sort({startsAt:1}).limit(1).next();
  if(!a)return res.json({appointment:null});
  const data=view(a);
  const ticket=a.queueTicketId?await db.collection('queueTickets').findOne({_id:a.queueTicketId}):null;
  const ready=ticket&&['waiting','assigned','serving'].includes(ticket.status);
  let peopleAhead=null, estimatedMinutes=null, next=false;
  if(ready){
    if(ticket.status==='serving'){peopleAhead=0;estimatedMinutes=0;}
    else {
      const waiting=await db.collection('queueTickets').find({queueDate:ticket.queueDate,status:{$in:['waiting','assigned']},preferredBarberId:{$in:[a.barberId,null]}}).sort({appointmentPriority:-1,queueNumber:1}).toArray();
      const at=waiting.findIndex(t=>String(t._id)===String(ticket._id));
      if(at>=0){
        const ahead=waiting.slice(0,at);
        peopleAhead=ahead.length;
        const serving=await db.collection('queueTickets').findOne({queueDate:ticket.queueDate,status:'serving',barberId:a.barberId});
        const remaining=serving?Math.max(0,(serving.durationMinutes||30)-Math.floor((Date.now()-new Date(serving.calledAt||serving.createdAt))/60000)):0;
        estimatedMinutes=Math.max(0,remaining)+ahead.reduce((n,t)=>n+(t.durationMinutes||30),0);
        next=at===0&&!serving;
      }
    }
  }
  res.json({appointment:{...data,queueNumber:ticket?.queueNumber||null,queueStatus:ticket?.status||null,peopleAhead,estimatedMinutes,next}});
});

router.get('/mine', ...customerOnly, async (req,res) => {
  const items=await req.app.locals.db.collection('appointments').find({customerId:req.user._id,hiddenFromCustomerHistory:{$ne:true}}).sort({startsAt:-1}).limit(100).toArray();
  // Show the saved haircut photo; older appointments can use their service's current image.
  const missing=[...new Set(items.filter(a=>!a.imageUrl&&a.serviceId).map(a=>String(a.serviceId)))].map(toObjectId).filter(Boolean);
  const services=missing.length?await req.app.locals.db.collection('services').find({_id:{$in:missing}},{projection:{imageUrl:1}}).toArray():[];
  const images=new Map(services.map(s=>[String(s._id),s.imageUrl||'']));
  res.json(items.map(a=>({...view(a),imageUrl:a.imageUrl||images.get(String(a.serviceId))||''})));
});
// Customer-only history removal: retain the original appointment for staff, reports and payments.
router.post('/:id/hide-history',...customerOnly,async(req,res)=>{
  const id=toObjectId(req.params.id);
  if(!id)return res.status(400).json({error:'Invalid appointment.'});
  const result=await req.app.locals.db.collection('appointments').findOneAndUpdate(
    {_id:id,customerId:req.user._id,hiddenFromCustomerHistory:{$ne:true},$or:[{status:{$nin:ACTIVE_BOOKINGS}},{startsAt:{$lte:new Date()}}]},
    {$set:{hiddenFromCustomerHistory:true,hiddenFromCustomerHistoryAt:new Date()}}
  );
  if(!result)return res.status(409).json({error:'This appointment is unavailable or cannot be removed from history.'});
  await audit(req,'appointment.history-hidden',{appointmentId:String(id)});
  res.json({message:'Appointment removed from your history.'});
});

router.get('/notifications', requireAuth, async (req,res) => {
  const filter=req.user.role==='customer'?{customerId:req.user._id}:{type:{$in:['created','cancelled','confirmed','checked-in','no-show']}};
  const items=await req.app.locals.db.collection('appointmentNotifications').find(filter).sort({createdAt:-1}).limit(req.query.all === '1' ? 0 : 50).toArray();
  res.json(items.map(n=>({id:String(n._id),title:n.title,message:n.message,type:n.type,read:req.user.role==='customer'?n.read:(n.staffReadBy||[]).some(id=>String(id)===String(req.user._id)),createdAt:n.createdAt})));
});
router.patch('/notifications/read-all', requireAuth, async (req,res) => {
  const notifications = req.app.locals.db.collection('appointmentNotifications');
  let result;
  if (req.user.role === 'customer') {
    result = await notifications.updateMany(
      {customerId:req.user._id, read:false},
      {$set:{read:true}}
    );
  } else if (['admin', 'cashier'].includes(req.user.role)) {
    // Staff have independent read status; do not mark customers' copies as read.
    result = await notifications.updateMany(
      {type:{$in:['created','cancelled','confirmed','checked-in','no-show']}, staffReadBy:{$ne:req.user._id}},
      {$addToSet:{staffReadBy:req.user._id}}
    );
  } else {
    return res.status(403).json({error:'Not allowed to mark notifications as read.'});
  }
  res.json({message:'All notifications marked as read.', count:result.modifiedCount});
});
router.patch('/notifications/:id/read',requireAuth,async(req,res)=>{
  const id=toObjectId(req.params.id);if(!id)return res.status(400).json({error:'Invalid notification.'});
  const filter={_id:id,...(req.user.role==='customer'?{customerId:req.user._id}:{type:{$in:['created','cancelled','confirmed','checked-in','no-show']}})};
  const update=req.user.role==='customer'?{$set:{read:true}}:{$addToSet:{staffReadBy:req.user._id}};
  await req.app.locals.db.collection('appointmentNotifications').updateOne(filter,update);
  res.json({message:'Marked as read.'});
});
// Admin monitoring: read-only. Cashier operations remain on /staff.
router.get('/admin',requireAuth,requireRole('admin'),async(req,res)=>{
  const db=req.app.locals.db;
  const items=await db.collection('appointments').find({}).sort({startsAt:-1}).limit(2000).toArray();
  const customerIds=[...new Map(items.filter(a=>a.customerId).map(a=>[String(a.customerId),a.customerId])).values()];
  const customers=customerIds.length?await db.collection('users').find({_id:{$in:customerIds}},{projection:{photoUrl:1}}).toArray():[];
  const photos=new Map(customers.map(customer=>[String(customer._id),customer.photoUrl||'']));
  res.json(items.map(a=>({...view(a),customerPhotoUrl:photos.get(String(a.customerId))||''})));
});
router.get('/staff',...staffOnly,async(req,res)=>{
  const db=req.app.locals.db;
  const items=await db.collection('appointments').find({startsAt:{$gte:new Date(Date.now()-86400000)}}).sort({startsAt:1}).limit(150).toArray();
  const customerIds=[...new Map(items.filter(a=>a.customerId).map(a=>[String(a.customerId),a.customerId])).values()];
  const customers=customerIds.length?await db.collection('users').find({_id:{$in:customerIds}},{projection:{photoUrl:1}}).toArray():[];
  const photos=new Map(customers.map(customer=>[String(customer._id),customer.photoUrl||'']));
  res.json(items.map(a=>({...view(a),customerPhotoUrl:photos.get(String(a.customerId))||''})));
});
// Availability preview follows the same occupied 5-minute slot records used
// by booking transactions. This is advisory: POST still enforces conflicts.
router.get('/availability', ...customerOnly, async (req,res) => {
  const db=req.app.locals.db;
  const serviceIds=readServiceIds(req.query.serviceIds?{serviceIds:String(req.query.serviceIds).split(",")}:{serviceId:req.query.serviceId});
  const barberId=req.query.barberId?toObjectId(req.query.barberId):null;
  const date=String(req.query.date||'');
  if(!serviceIds||(req.query.barberId&&!barberId)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))
    return res.status(400).json({error:'Choose a valid service, date, and barber.'});
  const dateStart=new Date(`${date}T00:00:00+08:00`);
  if(!Number.isFinite(dateStart.getTime())||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)
    return res.status(400).json({error:'Invalid appointment date.'});
  const now=Date.now();
  const manilaKey=value=>{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
    const get=type=>parts.find(part=>part.type===type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const lastDate=manilaKey(now+60*86400000);
  const today=manilaKey(now);
  if(date<today||date>lastDate||new Date(`${date}T00:00:00Z`).getUTCDay()===0)
    return res.status(400).json({error:'Select a Monday–Saturday date within the next 60 days.'});
  const services=await getSelectedServices(db,serviceIds);
  if(!services)
    return res.status(404).json({error:'Selected haircut service is unavailable.'});
  const barbers=await db.collection('barbers').find(barberId?{_id:barberId,active:true}:{active:true}).project({_id:1}).toArray();
  const barberIds=barbers.map(b=>b._id);
  const endOfDay=new Date(dateStart.getTime()+86400000);
  // When editing, exclude only this customer's own reservation; another customer's occupied slots remain blocked.
  const excludeId=req.query.excludeAppointmentId?toObjectId(req.query.excludeAppointmentId):null;
  if(req.query.excludeAppointmentId&&!excludeId)return res.status(400).json({error:'Invalid appointment selection.'});
  if(excludeId){
    const own=await db.collection('appointments').findOne({_id:excludeId,customerId:req.user._id,status:{$in:UPCOMING_BOOKINGS}});
    if(!own||new Date(own.startsAt).getTime()<=now+2*3600000)
      return res.status(409).json({error:'This appointment can no longer be rescheduled.'});
  }
  const occupiedFilter={barberId:{$in:barberIds},slot:{$gte:dateStart.toISOString(),$lt:endOfDay.toISOString()}};
  if(excludeId)occupiedFilter.appointmentId={$ne:excludeId};
  const occupied=barberIds.length?await db.collection('appointmentSlots').find(occupiedFilter,{projection:{barberId:1,slot:1}}).toArray():[];
  const occupiedByBarber=new Map(barberIds.map(id=>[String(id),new Set()]));
  for(const entry of occupied)occupiedByBarber.get(String(entry.barberId))?.add(entry.slot);
  const slots=[];
  const remainingMorning = MORNING_CAPACITY - await morningCount(db,date,excludeId);
  const duration=serviceSnapshot(services).durationMinutes;
  for(const start of makeStartTimes(duration)){
    const hour=String(Math.floor(start/60)).padStart(2,'0');
    const minute=String(start%60).padStart(2,'0');
    const time=`${hour}:${minute}`;
    const startAt=new Date(`${date}T${time}:00+08:00`);
    if(startAt.getTime()<now+5*60000)continue;
    const needed=[];
    for(let t=startAt.getTime();t<startAt.getTime()+duration*60000;t+=5*60000)needed.push(new Date(t).toISOString());
    const available=(start >= LUNCH_END || remainingMorning > 0) && barberIds.some(id=>needed.every(key=>!occupiedByBarber.get(String(id)).has(key)));
    const label=startAt.toLocaleTimeString('en-US',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',hour12:true});
    slots.push({time,label,available});
  }
  res.set('Cache-Control','no-store');
  res.json({slots,morningBooked:MORNING_CAPACITY-remainingMorning,morningRemaining:Math.max(0,remainingMorning),morningCapacity:MORNING_CAPACITY});
});

router.post('/',...customerOnly,async(req,res)=>{
  const db=req.app.locals.db;
  const serviceIds=readServiceIds(req.body);
  const requestedBarberId=req.body.barberId?toObjectId(req.body.barberId):null;
  const method=String(req.body.method||'').toLowerCase();
  const date=String(req.body.date||''),time=String(req.body.time||'');
  if(!serviceIds||(req.body.barberId&&!requestedBarberId)||!METHODS.includes(method)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))return res.status(400).json({error:'Choose a service, date, time, and payment method.'});
  const startsAt=new Date(`${date}T${time}:00+08:00`);
  if(!Number.isFinite(minutes(startsAt))||startsAt.toLocaleDateString('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})!==date||startsAt.getTime()<Date.now()+5*60000||startsAt.getTime()>Date.now()+60*86400000)return res.status(400).json({error:'Select a valid future schedule within 60 days.'});
  const localDay=new Date(`${date}T00:00:00Z`).getUTCDay();
  if(localDay===0)return res.status(400).json({error:'The barbershop is closed every Sunday. Please select another date.'});
  // Available starts are anchored to 8:00 AM and 1:00 PM in 25-minute steps.
  const startMinutes=Number(time.slice(0,2))*60+Number(time.slice(3,5));
  if(!validStart(startMinutes,1))return res.status(400).json({error:'Choose a 25-minute time slot from 8:00 AM, excluding lunch 12:00–1:00 PM.'});
  const services=await getSelectedServices(db,serviceIds);
  if(!services)return res.status(404).json({error:'One or more selected services are unavailable.'});
  const selection=serviceSnapshot(services);
  const barberFilter=requestedBarberId?{_id:requestedBarberId,active:true}:{active:true};
  const barbers=await db.collection('barbers').find(barberFilter).sort({name:1}).toArray();
  if(!barbers.length)return res.status(409).json({error:'No available barbers for this service.'});
  if(!Number.isInteger(selection.durationMinutes)||selection.durationMinutes<=0)return res.status(400).json({error:'Selected services have an invalid duration.'});
  if(!validStart(startMinutes,selection.durationMinutes))return res.status(400).json({error:'The haircut must finish before lunch (12:00 PM) or closing (7:00 PM). Choose another slot.'});
  const endsAt=new Date(startsAt.getTime()+selection.durationMinutes*60000);
  const slotKeys=[];
  for(let t=startsAt.getTime();t<endsAt.getTime();t+=5*60000)slotKeys.push(new Date(t).toISOString());
  const customer=await db.collection('users').findOne({_id:req.user._id});
  if(!customer)return res.status(401).json({error:'Customer account not found.'});
  const bookingDay=manilaDateRange(date);
  let appointment=null;
  for(const barber of barbers){
    const a={customerId:req.user._id,customerName:customer.name,customerEmail:customer.email,...selection,barberId:barber._id,barberName:barber.name,startsAt,endsAt,method,status:process.env.APPOINTMENT_APPROVAL==='cashier'?'pending':'confirmed',createdAt:new Date()};
    const session=req.app.locals.mongoClient?.startSession?.();
    if(!session)return res.status(503).json({error:'Booking transaction is unavailable.'});
    try{
      await session.withTransaction(async()=>{
        // Serialize concurrent bookings by this customer before enforcing limits.
        // The user-document write ensures simultaneous requests cannot both pass.
        await db.collection('users').updateOne({_id:req.user._id},{$currentDate:{lastBookingAttemptAt:true}},{session});
        if(startMinutes<LUNCH_START)await reserveMorningCapacity(db,date,null,session);
        const sameDay=await db.collection('appointments').findOne({
          customerId:req.user._id,status:{$in:ACTIVE_BOOKINGS},
          startsAt:{$gte:bookingDay.start,$lt:bookingDay.end}
        },{session,projection:{_id:1}});
        if(sameDay){const error=new Error('You already have an active appointment on this date. Please choose another date or cancel your existing appointment.');error.status=409;throw error;}
        const upcoming=await db.collection('appointments').countDocuments({
          customerId:req.user._id,status:{$in:UPCOMING_BOOKINGS},
          startsAt:{$gte:new Date()}
        },{session});
        if(upcoming>=MAX_UPCOMING_BOOKINGS){const error=new Error('You already have 3 upcoming appointments. Please complete or cancel an appointment before booking another.');error.status=409;throw error;}
        const result=await db.collection('appointments').insertOne(a,{session});a._id=result.insertedId;
        await db.collection('appointmentSlots').insertMany(slotKeys.map(slot=>({barberId:barber._id,slot,appointmentId:a._id})),{session});
      });
      appointment=a;
      break;
    }catch(err){
      if(err.status===409)return res.status(409).json({error:err.message});
      if(err.code!==11000)throw err;
    }finally{await session.endSession();}
  }
  if(!appointment)return res.status(409).json({error:'No barber is available at that time. Please choose another slot.'});
  try{await notify(db,appointment,'created',appointment.status==='confirmed'?'Renz Barbershop: Booking confirmed':'Renz Barbershop: Booking received',`Hi ${appointment.customerName}, your ${appointment.service} with ${appointment.barberName} is ${appointment.status} for ${date} at ${time}. Payment: ${appointment.method}.`);}catch(error){console.error("Appointment notification failed:",error.message);}
  await audit(req, 'appointment.booked', { appointmentId: String(appointment._id), service: appointment.service, date, time });
  res.status(201).json(view(appointment));
});
// Customer rescheduling is restricted to the same service, barber and payment method.
// Route added before the existing cancellation handler; all original routes remain unchanged.
router.patch('/:id/reschedule', ...customerOnly, async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.id);
  const date = String(req.body?.date || '');
  const time = String(req.body?.time || '');
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    return res.status(400).json({ error: 'Select a valid appointment date and time.' });
  const validDay = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(validDay.getTime()) || validDay.toISOString().slice(0, 10) !== date || validDay.getUTCDay() === 0)
    return res.status(400).json({ error: 'Select a valid Monday–Saturday date.' });
  const startsAt = new Date(`${date}T${time}:00+08:00`);
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() < now + 5 * 60000 || startsAt.getTime() > now + 60 * 86400000)
    return res.status(400).json({ error: 'Select an available future schedule within 60 days.' });
  const startMinute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (!validStart(startMinute,1))
    return res.status(400).json({ error: 'Choose a 25-minute slot starting from 8:00 AM or 1:00 PM.' });
  const session = req.app.locals.mongoClient?.startSession?.();
  if (!session) return res.status(503).json({ error: 'Rescheduling is temporarily unavailable. Please try again.' });
  let updated;
  try {
    await session.withTransaction(async () => {
      // Customer document is used as a concurrency lock, matching appointment creation.
      await db.collection('users').updateOne({ _id: req.user._id }, { $currentDate: { lastBookingAttemptAt: true } }, { session });
      const a = await db.collection('appointments').findOne({ _id: id, customerId: req.user._id, status: { $in: ['pending', 'confirmed'] } }, { session });
      if (!a) { const e = new Error('Appointment not found or can no longer be rescheduled.'); e.status = 409; throw e; }
      if (new Date(a.startsAt).getTime() <= Date.now() + twoHours) {
        const e = new Error('Rescheduling closes 2 hours before your original appointment.'); e.status = 409; throw e;
      }
      const service = await db.collection('services').findOne({ _id: a.serviceId, active: { $ne: false } }, { session });
      const barber = await db.collection('barbers').findOne({ _id: a.barberId, active: true }, { session });
      if (!service || !barber) { const e = new Error('Your booked haircut or barber is no longer available. Please contact the shop.'); e.status = 409; throw e; }
      const duration = Number(a.durationMinutes);
      if (!validStart(startMinute,duration)) {
        const e = new Error('The haircut must finish before lunch or closing. Please choose another time.'); e.status = 400; throw e;
      }
      if(startMinute<LUNCH_START)await reserveMorningCapacity(db,date,id,session);
      const day = manilaDateRange(date);
      const conflict = await db.collection('appointments').findOne({
        _id: { $ne: id }, customerId: req.user._id, status: { $in: ACTIVE_BOOKINGS },
        startsAt: { $gte: day.start, $lt: day.end }
      }, { session, projection: { _id: 1 } });
      if (conflict) { const e = new Error('You already have another active appointment on this date.'); e.status = 409; throw e; }
      const endsAt = new Date(startsAt.getTime() + duration * 60000);
      const slots = [];
      for (let t = startsAt.getTime(); t < endsAt.getTime(); t += 5 * 60000) slots.push(new Date(t).toISOString());
      const existing = await db.collection('appointmentSlots').findOne({
        barberId: a.barberId, slot: { $in: slots }, appointmentId: { $ne: id }
      }, { session, projection: { _id: 1 } });
      if (existing) { const e = new Error('This time is already booked. Please choose another available slot.'); e.status = 409; throw e; }
      // Remove and reinsert reservations in one transaction so the old slot is never lost on failure.
      await db.collection('appointmentSlots').deleteMany({ appointmentId: id }, { session });
      await db.collection('appointmentSlots').insertMany(slots.map(slot => ({ barberId: a.barberId, slot, appointmentId: id })), { session });
      const result = await db.collection('appointments').updateOne({ _id: id, customerId: req.user._id, startsAt: a.startsAt, status: a.status },
        { $set: { startsAt, endsAt, updatedAt: new Date(), rescheduledAt: new Date() }, $inc: { rescheduleCount: 1 } }, { session });
      if (!result.modifiedCount) { const e = new Error('This appointment changed. Please refresh and try again.'); e.status = 409; throw e; }
      updated = { ...a, startsAt, endsAt };
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 11000 || error.code === 112 || error.hasErrorLabel?.('TransientTransactionError'))
      return res.status(409).json({ error: 'The selected slot was just taken or updated. Please select another time.' });
    console.error('Appointment reschedule failed:', error);
    return res.status(500).json({ error: 'Could not reschedule the appointment. Please try again.' });
  } finally { await session.endSession(); }
  // Each successful reschedule generates a distinct event so future updates are not suppressed.
  try {
    await notify(db, updated, `rescheduled:${updated.startsAt.toISOString()}:${Date.now()}`, 'Renz Barbershop: Appointment rescheduled',
      `Your ${updated.service} with ${updated.barberName} was rescheduled to ${date} at ${time}.`);
  } catch (error) { console.error('Appointment reschedule notification failed:', error.message); }
  await audit(req, 'appointment.rescheduled', { appointmentId: String(updated._id), service: updated.service, date, time });
  res.json({ message: 'Appointment rescheduled.', appointment: view(updated) });
});
// Edit an existing appointment without creating a new booking.
router.patch('/:id/edit',...customerOnly,async(req,res)=>{
  const db=req.app.locals.db,id=toObjectId(req.params.id),serviceIds=readServiceIds(req.body);
  const requestedBarberId=req.body?.barberId?toObjectId(req.body.barberId):null;
  const date=String(req.body?.date||''),time=String(req.body?.time||''),method=String(req.body?.method||'').toLowerCase();
  if(!id||!serviceIds||(req.body?.barberId&&!requestedBarberId)||!METHODS.includes(method)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))return res.status(400).json({error:'Choose a valid haircut, barber, date, time, and payment method.'});
  const day=new Date(`${date}T00:00:00Z`),startsAt=new Date(`${date}T${time}:00+08:00`);
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==date||day.getUTCDay()===0)return res.status(400).json({error:'Select a valid Monday–Saturday date.'});
  if(!Number.isFinite(startsAt.getTime())||startsAt.getTime()<Date.now()+5*60000||startsAt.getTime()>Date.now()+60*86400000)return res.status(400).json({error:'Choose a future appointment within 60 days.'});
  const startMinutes=Number(time.slice(0,2))*60+Number(time.slice(3,5));
  if(!validStart(startMinutes,1))return res.status(400).json({error:'Choose a 25-minute slot starting from 8:00 AM or 1:00 PM.'});
  const session=req.app.locals.mongoClient?.startSession?.();
  if(!session)return res.status(503).json({error:'Appointment editing is temporarily unavailable.'});
  let updated;
  try{
    await session.withTransaction(async()=>{
      const fail=(message,status=409)=>{const e=new Error(message);e.status=status;throw e;};
      await db.collection('users').updateOne({_id:req.user._id},{$currentDate:{lastBookingAttemptAt:true}},{session});
      const a=await db.collection('appointments').findOne({_id:id,customerId:req.user._id,status:{$in:UPCOMING_BOOKINGS}},{session});
      if(!a)fail('Appointment not found or no longer editable.');
      if(new Date(a.startsAt).getTime()<=Date.now()+2*3600000)fail('Editing closes 2 hours before your original appointment.');
      const services=await getSelectedServices(db,serviceIds,session);
      if(!services)fail('One or more selected services are unavailable.');
      const selection=serviceSnapshot(services);
      if(!validStart(startMinutes,selection.durationMinutes))fail('The haircut must finish before lunch or closing.',400);
      if(startMinutes<LUNCH_START)await reserveMorningCapacity(db,date,id,session);
      const barberFilter=requestedBarberId?{_id:requestedBarberId,active:true}:{active:true};
      const barbers=await db.collection('barbers').find(barberFilter,{session}).sort({name:1}).toArray();
      if(!barbers.length)fail('No active barber is available.');
      const range=manilaDateRange(date);
      const conflict=await db.collection('appointments').findOne({_id:{$ne:id},customerId:req.user._id,status:{$in:ACTIVE_BOOKINGS},startsAt:{$gte:range.start,$lt:range.end}},{session,projection:{_id:1}});
      if(conflict)fail('You already have another active appointment on this date.');
      const endsAt=new Date(startsAt.getTime()+selection.durationMinutes*60000),slots=[];
      for(let t=startsAt.getTime();t<endsAt.getTime();t+=5*60000)slots.push(new Date(t).toISOString());
      for(const barber of barbers){
        const blocked=await db.collection('appointmentSlots').findOne({barberId:barber._id,slot:{$in:slots},appointmentId:{$ne:id}},{session,projection:{_id:1}});
        if(blocked)continue;
        const changes={...selection,barberId:barber._id,barberName:barber.name,startsAt,endsAt,method,updatedAt:new Date(),rescheduledAt:new Date()};
        // Both reservation changes and the appointment update commit together or roll back together.
        await db.collection('appointmentSlots').deleteMany({appointmentId:id},{session});
        await db.collection('appointmentSlots').insertMany(slots.map(slot=>({barberId:barber._id,slot,appointmentId:id})),{session});
        const result=await db.collection('appointments').updateOne({_id:id,customerId:req.user._id,startsAt:a.startsAt,status:a.status},{$set:changes,$inc:{rescheduleCount:1}},{session});
        if(!result.modifiedCount)fail('This appointment changed. Refresh and try again.');
        updated={...a,...changes};
        break;
      }
      if(!updated)fail('Selected time is already booked. Choose another available time.');
    });
  }catch(e){
    if(e.status)return res.status(e.status).json({error:e.message});
    if(e.code===11000||e.code===112||e.hasErrorLabel?.('TransientTransactionError'))return res.status(409).json({error:'The appointment or selected time changed. Please try again.'});
    console.error('Edit appointment failed:',e);
    return res.status(500).json({error:'Unable to save appointment changes. Please try again.'});
  }finally{await session.endSession();}
  try{await notify(db,updated,`edited:${Date.now()}`, 'Renz Barbershop: Appointment updated',`Your appointment is now ${updated.service} with ${updated.barberName} on ${date} at ${time}. Payment: ${method}.`);}catch(e){console.error('Edit notification failed:',e.message);}
  await audit(req, 'appointment.edited', { appointmentId: String(updated._id), service: updated.service, date, time });
  res.json({message:'Appointment updated successfully.',appointment:view(updated)});
});
router.post('/:id/cancel',requireAuth,async(req,res)=>{
  const db=req.app.locals.db,id=toObjectId(req.params.id);
  if(!id)return res.status(400).json({error:'Invalid appointment.'});
  const filter={_id:id,status:{$in:['pending','confirmed']},...(req.user.role==='customer'?{customerId:req.user._id,startsAt:{$gt:new Date()}}:{})};
  const a=await db.collection('appointments').findOneAndUpdate(filter,{$set:{status:'cancelled',cancelledAt:new Date()}});
  if(!a)return res.status(409).json({error:'Appointment not found or cannot be cancelled.'});
  await db.collection('appointmentSlots').deleteMany({appointmentId:a._id});
  try{await notify(db,a,'cancelled','Renz Barbershop: Booking cancelled',`Your appointment for ${a.service} with ${a.barberName} was cancelled.`);}catch(error){console.error("Appointment notification failed:",error.message);}
  await audit(req, 'appointment.cancelled', { appointmentId: String(a._id), service: a.service, customer: a.customerName });
  res.json({message:'Appointment cancelled.'});
});

// Staff check-in creates a normal queue ticket; payment and completion stay in existing front-desk flow.
router.post('/:id/checkin',...staffOnly,async(req,res)=>{
  const db=req.app.locals.db,id=toObjectId(req.params.id);
  if (await db.collection('dailyClosings').findOne({_id:require('../utils/dates').todayKey()})) return res.status(409).json({error:'Today’s operations are closed. Appointment check-in is unavailable.'});
  if(!id)return res.status(400).json({error:'Invalid appointment.'});
  const now=new Date();
  const a=await db.collection('appointments').findOne({_id:id,status:'confirmed'});
  if(!a)return res.status(409).json({error:'Only confirmed appointments can be checked in.'});
  if(a.startsAt.getTime()-Date.now()>10*60000||Date.now()-a.startsAt.getTime()>60*60000)return res.status(409).json({error:'Check-in is available from 10 minutes before to 60 minutes after the scheduled time.'});
  const active=await db.collection('queueTickets').findOne({customerId:a.customerId,queueDate:require('../utils/dates').todayKey(),status:{$in:['waiting','assigned','serving']}});
  if(active)return res.status(409).json({error:'This customer already has an active queue ticket today.'});
  const session=req.app.locals.mongoClient.startSession();
  let ticket;
  try{
    await session.withTransaction(async()=>{
      const claimed=await db.collection('appointments').updateOne({_id:id,status:'confirmed'},{$set:{status:'checked-in',checkedInAt:now}},{session});
      if(!claimed.modifiedCount){const err=new Error('This appointment was already checked in.');err.status=409;throw err;}
      const date=require('../utils/dates').todayKey();
      for(let attempt=0;attempt<5;attempt++){
        const last=await db.collection('queueTickets').find({queueDate:date},{session}).sort({queueNumber:-1}).limit(1).next();
        const queueNumber=last?last.queueNumber+1:1;
        const doc={queueDate:date,queueNumber,customerId:a.customerId,customerName:a.customerName,serviceId:a.serviceId,services:a.services||null,service:a.service,price:a.price,durationMinutes:a.durationMinutes,preferredBarberId:a.barberId,preferredBarberName:a.barberName,source:'appointment',appointmentId:a._id,appointmentPriority:1,status:'waiting',barberId:null,barberName:null,createdAt:now,calledAt:null,completedAt:null};
        try{const r=await db.collection('queueTickets').insertOne(doc,{session});ticket={...doc,_id:r.insertedId};break;}catch(e){if(e.code!==11000||attempt===4)throw e;}
      }
      await db.collection('appointments').updateOne({_id:id},{$set:{queueTicketId:ticket._id}},{session});
    });
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}finally{await session.endSession();}
  try{await notify(db,a,'checked-in','Renz Barbershop: Checked in',`You are checked in for ${a.service}. Your queue number is #${ticket.queueNumber}.`);}catch(error){console.error("Appointment notification failed:",error.message);}
  await audit(req, 'appointment.checked-in', { appointmentId: String(a._id), customer: a.customerName, queueNumber: ticket.queueNumber });
  res.json({message:`Checked in as queue #${ticket.queueNumber}. Complete service and collect payment using Front Desk.`,queueNumber:ticket.queueNumber});
});

router.post('/:id/status',...staffOnly,async(req,res)=>{
  const db=req.app.locals.db,id=toObjectId(req.params.id),status=String(req.body.status||'');
  if(!id||!['confirmed','no-show'].includes(status))return res.status(400).json({error:'Invalid status.'});
  const from=status==='confirmed'?['pending']:['confirmed'];
  const a=await db.collection('appointments').findOneAndUpdate({_id:id,status:{$in:from}},{$set:{status,updatedAt:new Date()}});
  if(!a)return res.status(409).json({error:'Appointment has already changed.'});
  if(status==='no-show')await db.collection('appointmentSlots').deleteMany({appointmentId:a._id});
  try{await notify(db,a,status,`Renz Barbershop: Appointment ${status}`,`Your appointment with ${a.barberName} is now ${status}.`);}catch(error){console.error("Appointment notification failed:",error.message);}
  await audit(req, 'appointment.status-updated', { appointmentId: String(a._id), customer: a.customerName, status });
  res.json({message:`Appointment ${status}.`});
});
module.exports={router,notify};
