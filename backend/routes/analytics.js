const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { todayKey, startOfDay, addDays, validDateKey } = require("../utils/dates");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const RANGES = {
  today: () => { const s = startOfDay(todayKey()); return [s, addDays(s, 1)]; },
  yesterday: () => { const s = addDays(startOfDay(todayKey()), -1); return [s, addDays(s, 1)]; },
  week: () => { const e = addDays(startOfDay(todayKey()), 1); return [addDays(e, -7), e]; },
  month: () => { const now = new Date(); return [new Date(now.getFullYear(), now.getMonth(), 1), addDays(startOfDay(todayKey()), 1)]; }
};

// All filter boundaries use the existing Asia/Manila date helpers.
function dateOffset(key, days) { return addDays(startOfDay(key), days); }
function yearMonthDay(key) { return key.split("-").map(Number); }
function monthStart(key, offset = 0) {
  const [y, m] = yearMonthDay(key);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function weekStart(key) {
  const day = new Date(`${key}T12:00:00Z`).getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(`${key}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
}
function analyticsDates(query) {
  const today = todayKey();
  const range = String(query.range || "today");
  if (range === "overall") return { range, start: new Date(0), end: dateOffset(today, 1), all: true };
  if (range === "specific") {
    if (!validDateKey(query.specificDate)) return { error: "Choose a valid specific date." };
    return { range, start: startOfDay(query.specificDate), end: dateOffset(query.specificDate, 1) };
  }
  if (range === "range" || range === "custom") {
    if (!validDateKey(query.from) || !validDateKey(query.to) || query.from > query.to) return { error: "Choose a valid date range." };
    const start = startOfDay(query.from), end = dateOffset(query.to, 1);
    if (end - start > 366 * 86400000) return { error: "Choose a range of one year or less." };
    return { range, start, end };
  }
  const week = weekStart(today);
  const [year] = yearMonthDay(today);
  const boundary = {
    thisWeek: [startOfDay(week), dateOffset(week, 7)],
    lastWeek: [dateOffset(week, -7), startOfDay(week)],
    thisMonth: [startOfDay(monthStart(today)), startOfDay(monthStart(today, 1))],
    lastMonth: [startOfDay(monthStart(today, -1)), startOfDay(monthStart(today))],
    thisYear: [startOfDay(`${year}-01-01`), startOfDay(`${year + 1}-01-01`)],
    lastYear: [startOfDay(`${year - 1}-01-01`), startOfDay(`${year}-01-01`)]
  };
  if (boundary[range]) return { range, start: boundary[range][0], end: boundary[range][1] };
  const legacy = RANGES[range] ? range : "today";
  const [start, end] = RANGES[legacy]();
  return { range: legacy, start, end };
}

function hourLabel(hour) {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
}

function topCounts(items, key, limit) {
  const counts = new Map();
  for (const item of items) {
    const name = item[key];
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// Live numbers for the admin dashboard, from queue tickets and payments.
router.get("/summary", async (req, res) => {
  const db = req.app.locals.db;
  const range = RANGES[req.query.range] ? req.query.range : "today";
  const [start, end] = RANGES[range]();

  const tickets = await db.collection("queueTickets").find({ createdAt: { $gte: start, $lt: end } }).toArray();
  const payments = await db.collection("payments").find({ createdAt: { $gte: start, $lt: end }, voided: { $ne: true } }).toArray();

  const completed = tickets.filter(t => t.status === "completed");
  const called = tickets.filter(t => t.calledAt);
  const averageWait = called.length
    ? Math.round(called.reduce((sum, t) => sum + (t.calledAt - t.createdAt), 0) / called.length / 60000)
    : null;

  // Customers per hour of the day (local time), shop hours 8 AM - 9 PM plus any outliers.
  const hours = new Map();
  for (let h = 8; h <= 21; h++) hours.set(h, 0);
  for (const t of tickets) {
    const h = t.createdAt.getHours();
    hours.set(h, (hours.get(h) || 0) + 1);
  }
  const customersPerHour = [...hours].sort((a, b) => a[0] - b[0]).map(([hour, count]) => ({ hour, label: hourLabel(hour), count }));

  const barberRatings = await db.collection("barberRatings").aggregate([
    { $group: { _id: "$barberId", avg: { $avg: "$rating" }, count: { $sum: 1 } } }
  ]).toArray();
  const ratingByBarber = new Map(barberRatings.map(r => [String(r._id), r]));

  const barberStats = new Map();
  for (const t of completed) {
    if (!t.barberId) continue;
    const key = String(t.barberId);
    const stat = barberStats.get(key) || { name: t.barberName, customers: 0, revenue: 0 };
    stat.customers += 1;
    stat.revenue += t.amountPaid || 0;
    barberStats.set(key, stat);
  }
  const topBarbers = [...barberStats].map(([id, s]) => ({
    ...s,
    averageRating: ratingByBarber.has(id) ? Math.round(ratingByBarber.get(id).avg * 10) / 10 : null
  })).sort((a, b) => b.customers - a.customers).slice(0, 5);

  const productSales = new Map();
  for (const p of payments.filter(p => p.type === "product")) {
    const sale = productSales.get(p.description) || { name: p.description, quantity: 0, revenue: 0 };
    sale.quantity += p.quantity || 0;
    sale.revenue += p.amount;
    productSales.set(p.description, sale);
  }

  const revenue = payments.reduce((sum, p) => sum + p.amount, 0);
  const lowStockItems = await db.collection("inventory").countDocuments({ $expr: { $lte: ["$quantity", "$minimumStock"] } });

  res.json({
    range,
    from: start,
    to: end,
    totals: {
      customers: tickets.length,
      served: completed.length,
      noShows: tickets.filter(t => t.status === "no-show").length,
      cancelled: tickets.filter(t => t.status === "cancelled").length,
      averageWaitMinutes: averageWait,
      revenue,
      serviceRevenue: payments.filter(p => p.type !== "product").reduce((sum, p) => sum + p.amount, 0),
      productRevenue: payments.filter(p => p.type === "product").reduce((sum, p) => sum + p.amount, 0),
      discounts: payments.reduce((sum, p) => sum + (p.discount || 0), 0),
      lowStockItems
    },
    customersPerHour,
    popularServices: topCounts(tickets.filter(t => t.status !== "cancelled"), "service", 5).map(([name, count]) => ({ name, count })),
    topBarbers,
    peakHours: [...customersPerHour].filter(h => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 3),
    mostSoldItems: [...productSales.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5)
  });
});


// Detailed, read-only chart data. All buckets follow the shop's Asia/Manila calendar.
router.get("/insights", async (req, res) => {
  const db = req.app.locals.db;
  const requested = analyticsDates(req.query);
  if (requested.error) return res.status(400).json({ error: requested.error });
  const { range, start, end } = requested;
  const paymentMethod = String(req.query.paymentMethod || "all").toLowerCase();
  const customerType = String(req.query.customerType || "all").toLowerCase();
  if (!["all", "cash", "gcash", "card", "other"].includes(paymentMethod)) return res.status(400).json({ error: "Choose a valid payment method." });
  if (!["all", "walkin", "appointment"].includes(customerType)) return res.status(400).json({ error: "Choose a valid customer type." });
  const timezone = "Asia/Manila";
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const key = date => { const parts = dayFmt.formatToParts(date); const o = Object.fromEntries(parts.map(x => [x.type, x.value])); return `${o.year}-${o.month}-${o.day}`; };
  // Overall includes all stored records, including future scheduled appointments.
  const dates = requested.all ? null : { $gte: start, $lt: end };
  const eventsMatch = dates ? [{ $match: { createdAt: dates } }] : [];
  const [allTickets, allPayments, allAppointments, inventory, ratings, inventoryMonths] = await Promise.all([
    db.collection("queueTickets").find(dates ? { createdAt: dates } : {}, { projection: { status: 1, service: 1, customerId: 1, source: 1, appointmentId: 1, barberId: 1, barberName: 1, createdAt: 1, calledAt: 1, completedAt: 1, amountPaid: 1 } }).toArray(),
    db.collection("payments").find({ ...(dates ? { createdAt: dates } : {}), voided: { $ne: true } }, { projection: { createdAt: 1, type: 1, method: 1, ticketId: 1, amount: 1, discount: 1, barberName: 1, description: 1, quantity: 1 } }).toArray(),
    db.collection("appointments").find(dates ? { startsAt: dates } : {}, { projection: { status: 1, startsAt: 1 } }).toArray(),
    db.collection("inventory").find({}, { projection: { name: 1, category: 1, quantity: 1, minimumStock: 1 } }).toArray(),
    db.collection("barberRatings").aggregate([{ $group: { _id: "$barberId", average: { $avg: "$rating" }, count: { $sum: 1 } } }]).toArray(),
    db.collection("inventoryEvents").aggregate([
      ...eventsMatch,
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } }, sold: { $sum: { $cond: [{ $eq: ["$type", "sold"] }, { $multiply: ["$quantityChange", -1] }, 0] } }, net: { $sum: "$quantityChange" } } },
      { $sort: { _id: 1 } }
    ]).toArray()
  ]);
  // Resolve service-payment tickets even when paid on a later day than the visit.
  // Unlinked product sales do not have a verifiable walk-in/appointment category.
  const matchedMethodPayments = paymentMethod === "all" ? allPayments : allPayments.filter(p => String(p.method || "").toLowerCase() === paymentMethod);
  const referencedIds = [...new Map(matchedMethodPayments.filter(p => p.ticketId).map(p => [String(p.ticketId), p.ticketId])).values()];
  const extraTickets = referencedIds.length ? await db.collection("queueTickets").find(
    { _id: { $in: referencedIds } }, { projection: { source: 1, appointmentId: 1 } }
  ).toArray() : [];
  const ticketById = new Map([...allTickets, ...extraTickets].map(t => [String(t._id), t]));
  const isAppointment = t => Boolean(t && (t.appointmentId || t.source === "appointment"));
  const matchType = t => customerType === "all" || (customerType === "appointment" ? isAppointment(t) : Boolean(t) && !isAppointment(t));
  const payments = matchedMethodPayments.filter(p => customerType === "all" || (p.ticketId && matchType(ticketById.get(String(p.ticketId)))));
  const paidTicketIds = new Set(payments.filter(p => p.ticketId).map(p => String(p.ticketId)));
  const tickets = allTickets.filter(t => matchType(t) && (paymentMethod === "all" || paidTicketIds.has(String(t._id))));
  const matchingAppointmentIds = new Set(tickets.filter(t => t.appointmentId).map(t => String(t.appointmentId)));
  const appointments = allAppointments.filter(a => {
    if (customerType === "walkin") return false;
    if (paymentMethod !== "all") return matchingAppointmentIds.has(String(a._id));
    return true;
  });
  const tickMap = new Map(), paymentMap = new Map(), stockMap = new Map();
  const durationDays = Math.round((end - start) / 86400000);
  const daily = !requested.all && durationDays <= 62;
  if (daily) {
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) tickMap.set(key(d), { label: key(d), visits: 0, revenue: 0, services: 0, products: 0 });
  }
  const bucket = date => daily ? key(date) : key(date).slice(0, 7);
  function ensure(k) { if (!tickMap.has(k)) tickMap.set(k, { label: k, visits: 0, revenue: 0, services: 0, products: 0 }); return tickMap.get(k); }
  const serviceCounts = new Map(), barberMap = new Map();
  const statuses = { waiting: 0, serving: 0, completed: 0, cancelled: 0, 'no-show': 0, expired: 0 };
  let appointmentVisits = 0, walkinVisits = 0, totalWait = 0, waitCount = 0, totalServiceMinutes = 0, durationCount = 0;
  for (const t of tickets) {
    ensure(bucket(t.createdAt)).visits++;
    const st = t.status === "assigned" ? "waiting" : t.status;
    statuses[st] = (statuses[st] || 0) + 1;
    if (isAppointment(t)) appointmentVisits++;
    else walkinVisits++;
    if (t.calledAt && new Date(t.calledAt) >= new Date(t.createdAt)) { totalWait += new Date(t.calledAt) - new Date(t.createdAt); waitCount++; }
    if (st !== "completed") continue;
    if (t.service) serviceCounts.set(t.service, (serviceCounts.get(t.service) || 0) + 1);
    if (t.calledAt && t.completedAt && new Date(t.completedAt) >= new Date(t.calledAt)) { totalServiceMinutes += new Date(t.completedAt) - new Date(t.calledAt); durationCount++; }
    if (t.barberId) {
      const id = String(t.barberId);
      const entry = barberMap.get(id) || { id, name: t.barberName || "Barber", completed: 0, revenue: 0 };
      entry.completed++; barberMap.set(id, entry);
    }
  }
  const methods = { cash: 0, gcash: 0, card: 0, other: 0 };
  const productMap = new Map();
  for (const pay of payments) {
    const amount = Number(pay.amount) || 0;
    const d = ensure(bucket(pay.createdAt));
    d.revenue += amount;
    d[pay.type === "product" ? "products" : "services"] += amount;
    methods[pay.method] = (methods[pay.method] || 0) + amount;
    if (pay.type === "product") {
      const name = pay.description || "Product";
      const item = productMap.get(name) || { name, quantity: 0, revenue: 0 };
      item.quantity += Number(pay.quantity) || 0; item.revenue += amount; productMap.set(name, item);
    }
    if (pay.type === "service" && pay.barberName) paymentMap.set(pay.barberName, (paymentMap.get(pay.barberName) || 0) + amount);
  }
  for (const bar of barberMap.values()) bar.revenue = paymentMap.get(bar.name) || 0;
  const bookingStatuses = {};
  for (const a of appointments) bookingStatuses[a.status || "unknown"] = (bookingStatuses[a.status || "unknown"] || 0) + 1;
  for (const e of inventoryMonths) stockMap.set(daily ? e._id : e._id.slice(0, 7), { sold: (stockMap.get(daily ? e._id : e._id.slice(0, 7))?.sold || 0) + e.sold, net: (stockMap.get(daily ? e._id : e._id.slice(0, 7))?.net || 0) + e.net });
  for (const dateBucket of stockMap.keys()) ensure(dateBucket);
  const trends = [...tickMap.values()].sort((a, b) => a.label.localeCompare(b.label)).map(row => ({ ...row, inventorySold: stockMap.get(row.label)?.sold || 0, inventoryChange: stockMap.get(row.label)?.net || 0 }));
  const topServices = [...serviceCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const topProducts = [...productMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 8);
  const byBarber = [...barberMap.values()].sort((a, b) => b.completed - a.completed);
  const rated = new Map(ratings.map(r => [String(r._id), r]));
  byBarber.forEach(b => { b.rating = rated.get(b.id)?.average ?? null; });
  res.json({ range, from: start, to: end, paymentMethod, customerType, trends, statuses, methods, bookingStatuses,
    topServices, topProducts, byBarber, appointmentVisits, walkinVisits,
    averageWaitMinutes: waitCount ? Math.round(totalWait / waitCount / 60000) : null,
    averageServiceMinutes: durationCount ? Math.round(totalServiceMinutes / durationCount / 60000) : null,
    inventory: { total: inventory.length, low: inventory.filter(i => i.quantity <= i.minimumStock).length,
      byCategory: [...inventory.reduce((m, i) => m.set(i.category || "Uncategorized", (m.get(i.category || "Uncategorized") || 0) + 1), new Map())].map(([name, count]) => ({ name, count })) },
    totals: { visits: tickets.length, served: statuses.completed, appointments: appointments.length,
      revenue: payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      serviceRevenue: payments.filter(p => p.type !== "product").reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      productRevenue: payments.filter(p => p.type === "product").reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      discounts: payments.reduce((sum, p) => sum + (Number(p.discount) || 0), 0) }
  });
});

// Inventory changes per month for a year, grouped in the shop's time zone.
router.get("/inventory-monthly", async (req, res) => {
  const db = req.app.locals.db;
  const year = Number(req.query.year || new Date().getFullYear());

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error: "Invalid year." });
  }

  const timezone = process.env.TZ;
  const data = await db.collection("inventoryEvents").aggregate([
    { $match: { createdAt: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) } } },
    {
      $group: {
        _id: { month: { $month: { date: "$createdAt", timezone } } },
        quantityChange: { $sum: "$quantityChange" },
        sold: { $sum: { $cond: [{ $eq: ["$type", "sold"] }, { $multiply: ["$quantityChange", -1] }, 0] } },
        eventCount: { $sum: 1 }
      }
    }
  ]).toArray();

  const months = Array.from({ length: 12 }, (_, i) => {
    const row = data.find(x => x._id.month === i + 1);
    return {
      month: i + 1,
      quantityChange: row?.quantityChange || 0,
      sold: row?.sold || 0,
      eventCount: row?.eventCount || 0
    };
  });

  res.json({ year, months });
});

module.exports = router;
