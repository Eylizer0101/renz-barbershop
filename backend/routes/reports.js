// Administrator-only, password-confirmed workbook export of stored business records.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const ExcelJS = require('exceljs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { DUMMY_HASH, audit } = require('../utils/security');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));
const exportLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true,
  legacyHeaders: false, message: { error: 'Too many export attempts. Try again in 15 minutes.' } });
const safe = value => {
  if (value == null) return '';
  if (value instanceof Date) return value;
  const s = String(value);
  // Excel formula injection: never treat untrusted names or descriptions as formulas.
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
};
const yesNo = value => value === false ? 'Inactive' : 'Active';
const id = value => value == null ? '' : String(value);
const when = value => value instanceof Date && !Number.isNaN(value.getTime()) ? value : '';
const fields = (headers, rows) => ({ headers, rows });

function addSheet(book, title, spec, generated) {
  const ws = book.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 5 }] });
  const last = spec.headers.length;
  ws.mergeCells(1, 1, 1, last);
  const banner = ws.getCell(1, 1);
  banner.value = `RENZ BARBERSHOP | ${title.toUpperCase()} RECORDS`;
  banner.font = { name: 'Arial', bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF593A28' } };
  banner.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 34;
  ws.mergeCells(2, 1, 2, last);
  const subtitle = ws.getCell(2, 1);
  subtitle.value = `Generated: ${generated.toLocaleString('en-PH', {timeZone:'Asia/Manila', year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit'})} (Philippine Time)   |   Total records: ${spec.rows.length}`;
  subtitle.font = { name:'Arial', size: 10, italic:true, color: {argb:'FF65584B'} };
  subtitle.alignment = { horizontal:'center' };
  ws.getRow(2).height = 23;
  const headings = ws.getRow(4);
  spec.headers.forEach((column, i) => {
    const cell = headings.getCell(i+1);
    cell.value = column;
    cell.font = { name:'Arial', bold:true, color:{argb:'FF20211F'}, size:10 };
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFDCC49E'} };
    cell.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
    cell.border = { bottom: { style:'thin', color:{argb:'FFAB8E66'} } };
  });
  headings.height = 30;
  spec.rows.forEach((data, index) => {
    const row = ws.getRow(index+5);
    data.forEach((v, i) => {
      const cell = row.getCell(i+1);
      cell.value = typeof v === 'number' && Number.isFinite(v) ? v : safe(v);
      if (v instanceof Date && !Number.isNaN(v.getTime())) { cell.value = v; cell.numFmt = 'mmm dd, yyyy hh:mm AM/PM'; }
      cell.alignment = { vertical:'middle', horizontal:'left', wrapText:true };
      cell.font = { name:'Arial', size:10, color:{argb:'FF252525'} };
      if (index % 2) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF8F5F0'} };
      cell.border = { bottom:{style:'hair', color:{argb:'FFE9E3DA'}} };
    });
    row.height = 22;
  });
  spec.headers.forEach((heading, i) => {
    const width = Math.min(42, Math.max(15, heading.length + 5, ...spec.rows.slice(0, 150).map(r => Math.min(42, String(r[i] ?? '').length + 2))));
    ws.getColumn(i+1).width = width;
  });
  ws.autoFilter = { from: { row:4, column:1 }, to: { row: Math.max(4, 4+spec.rows.length), column:last } };
  ws.pageSetup = { fitToPage:true, fitToWidth:1, fitToHeight:0, orientation:'landscape' };
}

router.post('/export-all', exportLimit, async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password.length > 256) return res.status(400).json({error:'Enter your administrator password.'});
  const db = req.app.locals.db;
  const admin = await db.collection('users').findOne({ _id:req.user._id, role:'admin', active:{$ne:false} }, {projection:{passwordHash:1}});
  const verified = await bcrypt.compare(password, admin?.passwordHash || DUMMY_HASH);
  if (!admin || !verified) {
    await audit(req, 'reports.export-denied', {reason:'invalid-password'});
    return res.status(403).json({error:'Incorrect admin password. Please try again.'});
  }

  const [customers, appointments, tickets, payments, services, barbers, inventory, staff] = await Promise.all([
    db.collection('users').find({role:'customer'}, {projection:{name:1,email:1,phone:1,createdAt:1,active:1,deletedAt:1}}).sort({createdAt:-1}).toArray(),
    db.collection('appointments').find({}, {projection:{customerName:1,service:1,barberName:1,startsAt:1,endsAt:1,price:1,method:1,status:1,createdAt:1}}).sort({createdAt:-1}).toArray(),
    db.collection('queueTickets').find({}, {projection:{queueDate:1,queueNumber:1,customerName:1,service:1,barberName:1,source:1,status:1,createdAt:1,calledAt:1,completedAt:1,amountPaid:1}}).sort({createdAt:-1}).toArray(),
    db.collection('payments').find({}, {projection:{createdAt:1,customerName:1,description:1,type:1,amount:1,listPrice:1,discount:1,method:1,voided:1,cashierName:1,barberName:1,queueNumber:1}}).sort({createdAt:-1}).toArray(),
    db.collection('services').find({}, {projection:{name:1,price:1,durationMinutes:1,active:1,createdAt:1,archivedAt:1}}).sort({name:1}).toArray(),
    db.collection('barbers').find({}, {projection:{name:1,specialty:1,experienceYears:1,available:1,active:1,createdAt:1}}).sort({name:1}).toArray(),
    db.collection('inventory').find({}, {projection:{name:1,category:1,quantity:1,unit:1,minimumStock:1,price:1,unitCost:1,supplier:1,active:1}}).sort({name:1}).toArray(),
    db.collection('users').find({role:{$in:['admin','cashier']}}, {projection:{name:1,email:1,role:1,active:1,createdAt:1}}).sort({role:1,name:1}).toArray()
  ]);
  const countMap = new Map();
  const visits = await db.collection('queueTickets').aggregate([
    {$match:{customerId:{$ne:null},status:'completed'}},
    {$group:{_id:'$customerId',count:{$sum:1}}}
  ]).toArray();
  for (const visit of visits) countMap.set(id(visit._id),visit.count);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Renz Barbershop';
  workbook.created = new Date();
  const sheets = [
    ['Customers', fields(['Date Registered','Full Name','Email','Contact Number','Total Completed Visits','Account Status'], customers.map(c => [when(c.createdAt),c.name,c.email,c.phone||'',countMap.get(id(c._id))||0,c.deletedAt?'Deleted':yesNo(c.active)]))],
    ['Appointments', fields(['Date Booked','Customer','Services','Barber','Scheduled Start','Scheduled End','Total Price (PHP)','Payment Method','Status'], appointments.map(a => [when(a.createdAt),a.customerName,a.service,a.barberName||'',when(a.startsAt),when(a.endsAt),a.price??0,a.method||'',a.status||'']))],
    ['Queue', fields(['Queue Date','Queue Number','Customer','Service','Barber','Customer Type','Created At','Called At','Completed At','Wait (min)','Status','Amount Paid (PHP)'], tickets.map(t => [t.queueDate,t.queueNumber,t.customerName,t.service,t.barberName||'',t.source||'',when(t.createdAt),when(t.calledAt),when(t.completedAt),t.calledAt&&t.createdAt?Math.max(0,Math.round((t.calledAt-t.createdAt)/60000)):'',t.status||'',t.amountPaid??'']))],
    ['Payments', fields(['Date','Customer','Description','Type','Barber','Queue Number','Amount (PHP)','List Price (PHP)','Discount (PHP)','Payment Method','Cashier','Payment Status'], payments.map(p => [when(p.createdAt),p.customerName||'',p.description||'',p.type||'',p.barberName||'',p.queueNumber??'',p.amount??0,p.listPrice??'',p.discount||0,p.method||'',p.cashierName||'',p.voided?'Voided':'Valid']))],
    ['Services', fields(['Service Name','Price (PHP)','Duration (min)','Status','Date Created','Archived At'], services.map(s => [s.name,s.price??0,s.durationMinutes??'',yesNo(s.active),when(s.createdAt),when(s.archivedAt)]))],
    ['Barbers', fields(['Barber Name','Specialization','Years of Experience','Duty Status','Account Status','Date Created'], barbers.map(b => [b.name,b.specialty||'',b.experienceYears||0,b.available?'Available':'Off Duty',yesNo(b.active),when(b.createdAt)]))],
    ['Inventory', fields(['Product Name','Category','Quantity','Unit','Minimum Stock','Stock Status','Selling Price (PHP)','Unit Cost (PHP)','Supplier','Status'], inventory.map(i => [i.name,i.category||'',i.quantity??0,i.unit||'pcs',i.minimumStock??0,Number(i.quantity||0)<=Number(i.minimumStock||0)?'Low Stock':'In Stock',i.price??0,i.unitCost??0,i.supplier||'',yesNo(i.active)]))],
    ['Staff', fields(['Date Created','Full Name','Email','Role','Status'], staff.map(u => [when(u.createdAt),u.name,u.email,u.role,yesNo(u.active)]))]
  ];
  const generated = new Date();
  for (const [title,spec] of sheets) addSheet(workbook,title,spec,generated);
  const nameDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(generated).replace(/\//g,'-');
  // Buffer workbook first so any generation error doesn't send a corrupted partial file.
  const buffer = await workbook.xlsx.writeBuffer();
  await audit(req,'reports.export-all',{counts:Object.fromEntries(sheets.map(([name,spec])=>[name,spec.rows.length]))});
  res.set({
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':`attachment; filename="renz-barbershop-all-records-${nameDate}.xlsx"`,
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  });
  res.send(Buffer.from(buffer));
});

module.exports = router;
