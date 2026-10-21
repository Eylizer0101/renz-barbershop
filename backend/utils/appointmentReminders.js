// Server-side worker: persists reminders and retryable messages in MongoDB.
const { sendAppointmentEmail } = require('./mailer');
const { notify } = require('../routes/appointments');
async function processAppointmentReminders(db) {
  const now=new Date();
  // Reminders are emitted 5-30 minutes before start; dedupe by event key.
  const bookings=await db.collection('appointments').find({status:'confirmed',startsAt:{$gte:new Date(now.getTime()+5*60000),$lte:new Date(now.getTime()+30*60000)}}).limit(100).toArray();
  for(const a of bookings){
    await notify(db,a,'reminder-30','Renz Barbershop: Appointment reminder',`Your ${a.service} appointment with ${a.barberName} starts at ${new Date(a.startsAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})}. Please arrive 10 minutes before your appointment time.`);
  }
  // A delay means the assigned barber is still serving another customer after
  // the appointment's scheduled start. Notify once for each 15-minute delay band.
  const delayed=await db.collection('appointments').find({status:'checked-in',startsAt:{$lte:new Date(now.getTime()-5*60000),$gte:new Date(now.getTime()-3*3600000)}}).limit(100).toArray();
  for(const a of delayed){
    const ticket=a.queueTicketId?await db.collection('queueTickets').findOne({_id:a.queueTicketId}):null;
    if(!ticket||!['waiting','assigned'].includes(ticket.status))continue;
    const serving=await db.collection('queueTickets').findOne({queueDate:ticket.queueDate,barberId:a.barberId,status:'serving'});
    if(!serving)continue;
    const remaining=Math.max(0,(serving.durationMinutes||30)-Math.floor((now-new Date(serving.calledAt||serving.createdAt))/60000));
    const waiting=await db.collection('queueTickets').find({queueDate:ticket.queueDate,status:{$in:['waiting','assigned']},preferredBarberId:{$in:[a.barberId,null]}}).sort({appointmentPriority:-1,queueNumber:1}).toArray();
    const index=waiting.findIndex(t=>String(t._id)===String(ticket._id));
    if(index<0)continue;
    const estimate=remaining+waiting.slice(0,index).reduce((n,t)=>n+(t.durationMinutes||30),0);
    const delay=Math.max(0,Math.floor((now-a.startsAt)/60000));
    const band=Math.floor(delay/15);
    if(!band)continue;
    await notify(db,a,`delayed-${band}`,'Renz Barbershop: Appointment delayed',`Your barber ${a.barberName} is running behind schedule. Updated estimated wait: about ${estimate} minutes. Please check the live dashboard for updates.`);
  }
  // Atomically claim each retry so parallel worker executions do not resend.
  const due=await db.collection('appointmentNotifications').find({emailStatus:'failed',emailAttempts:{$lt:3},nextEmailAttemptAt:{$lte:now}}).sort({createdAt:1}).limit(15).toArray();
  for(const n of due){
    const locked=await db.collection('appointmentNotifications').findOneAndUpdate({_id:n._id,emailStatus:'failed',emailAttempts:n.emailAttempts},{$set:{emailStatus:'sending'},$inc:{emailAttempts:1}});
    if(!locked)continue;
    const a=await db.collection('appointments').findOne({_id:n.appointmentId});
    if(!a){await db.collection('appointmentNotifications').updateOne({_id:n._id},{$set:{emailStatus:'skipped'}});continue;}
    try {await sendAppointmentEmail(a.customerEmail,n.title,n.message,a);await db.collection('appointmentNotifications').updateOne({_id:n._id},{$set:{emailStatus:'sent',sentAt:new Date()}});}
    catch(e){console.error('Appointment email retry failed:',e.code||e.message);await db.collection('appointmentNotifications').updateOne({_id:n._id},{$set:{emailStatus:'failed',nextEmailAttemptAt:new Date(Date.now()+Math.min(15,2**n.emailAttempts)*60000)}});}
  }
}
module.exports={processAppointmentReminders};
