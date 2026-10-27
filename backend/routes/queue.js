const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth, optionalAuth, requireRole } = require("../middleware/auth");
const { cleanText, validName, toObjectId } = require("../utils/validation");
const { ticketCookie } = require("../utils/session");
const { todayKey } = require("../utils/dates");
const { audit } = require("../utils/security");

const router = express.Router();

// A closed shop day cannot accept new queue tickets or mutate the daily queue.
router.use(async (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (req.path === "/close-day") return next();
  const closed = await req.app.locals.db.collection("dailyClosings").findOne({ _id: todayKey() }, { projection: { _id: 1 } });
  if (closed) return res.status(409).json({ error: "Today's operations have already been closed. New queue actions are unavailable until tomorrow." });
  next();
});

const staffOnly = [requireAuth, requireRole("admin", "cashier")];

// Tickets from older versions may say "assigned"; they are treated as waiting.
const WAITING = ["waiting", "assigned"];
const ACTIVE = ["waiting", "assigned", "serving"];
const PAYMENT_METHODS = ["cash", "gcash", "card", "other"];
const DEFAULT_DURATION = 30;

// Online joins: limits per device, and a cap on the waiting line, so nobody can flood the queue
// with fake tickets. Walk-ins added by the cashier are not limited.
const MAX_ONLINE_WAITING = Number(process.env.MAX_ONLINE_WAITING) || 60;
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many queue requests from this device. Please ask at the counter." }
});

// "Juan Dela Cruz" -> "Juan C." for public screens.
function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "Customer";
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function ticketView(t) {
  return {
    id: String(t._id),
    queueNumber: t.queueNumber,
    customerName: t.customerName,
    hasAccount: Boolean(t.customerId),
    service: t.service,
    price: t.price ?? null,
    durationMinutes: t.durationMinutes || DEFAULT_DURATION,
    preferredBarberId: t.preferredBarberId ? String(t.preferredBarberId) : null,
    preferredBarberName: t.preferredBarberName || null,
    barberId: t.barberId ? String(t.barberId) : null,
    barberName: t.barberName || null,
    status: t.status === "assigned" ? "waiting" : t.status,
    source: t.source || "guest",
    amountPaid: t.amountPaid ?? null,
    createdAt: t.createdAt,
    calledAt: t.calledAt || null,
    completedAt: t.completedAt || null,
    paymentId: t.paymentId ? String(t.paymentId) : null,
    paymentStatus: t.paymentId ? "paid" : t.status === "completed" ? "unpaid" : "not-due"
  };
}

// Wait = service time of everyone ahead, shared between the barbers on duty.
async function waitEstimate(db, queueNumber) {
  const filter = { queueDate: todayKey(), status: { $in: WAITING } };
  if (queueNumber) filter.queueNumber = { $lt: queueNumber };

  const ahead = await db.collection("queueTickets")
    .find(filter, { projection: { durationMinutes: 1 } })
    .toArray();

  const minutes = ahead.reduce((sum, t) => sum + (t.durationMinutes || DEFAULT_DURATION), 0);
  const barbers = await db.collection("barbers").countDocuments({ active: true, available: true });

  return { peopleAhead: ahead.length, estimatedMinutes: Math.ceil(minutes / Math.max(1, barbers)) };
}

async function nextQueueNumber(db, date) {
  const last = await db.collection("queueTickets")
    .find({ queueDate: date })
    .sort({ queueNumber: -1 })
    .limit(1)
    .next();

  return last ? last.queueNumber + 1 : 1;
}

async function createTicket(db, fields) {
  const date = todayKey();

  for (let attempt = 1; ; attempt++) {
    const ticket = {
      queueDate: date,
      queueNumber: await nextQueueNumber(db, date),
      ...fields,
      status: "waiting",
      barberId: null,
      barberName: null,
      createdAt: new Date(),
      calledAt: null,
      completedAt: null
    };

    try {
      await db.collection("queueTickets").insertOne(ticket);
      return ticket;
    } catch (error) {
      // Another customer took this number at the same moment; try the next one.
      if (error.code !== 11000 || attempt >= 5) throw error;
    }
  }
}

// The chosen service (required) and preferred barber (optional) for a new ticket.
async function readOrder(db, body) {
  const serviceId = toObjectId(body.serviceId);
  const service = serviceId && await db.collection("services").findOne({ _id: serviceId, active: { $ne: false } });
  if (!service) return { error: "Please select a service." };

  const fields = {
    serviceId: service._id,
    service: service.name,
    price: service.price,
    durationMinutes: service.durationMinutes,
    preferredBarberId: null,
    preferredBarberName: null
  };

  if (body.preferredBarberId) {
    const barberId = toObjectId(body.preferredBarberId);
    const barber = barberId && await db.collection("barbers").findOne({ _id: barberId, active: true });
    if (!barber) return { error: "That barber is not available. Choose another barber or any barber." };

    fields.preferredBarberId = barber._id;
    fields.preferredBarberName = barber.name;
  }

  return { fields };
}

// A signed-in customer's ticket, or the one this device joined with as a guest.
function ownTicketFilter(req) {
  if (req.user?.role === "customer") return { customerId: req.user._id, queueDate: todayKey() };

  const id = toObjectId(req.signedCookies.queueTicket);
  return id ? { _id: id, queueDate: todayKey() } : null;
}

async function findOwnTicket(db, req) {
  const filter = ownTicketFilter(req);
  if (!filter) return null;

  return db.collection("queueTickets").find(filter).sort({ createdAt: -1 }).limit(1).next();
}

// A barber who is on duty and not already serving someone.
async function freeBarber(db, barberIdValue) {
  const barberId = toObjectId(barberIdValue);
  const barber = barberId && await db.collection("barbers").findOne({ _id: barberId, active: true });

  if (!barber) return { status: 400, error: "Choose a barber." };
  if (!barber.available) return { status: 409, error: `${barber.name} is marked unavailable.` };

  const serving = await db.collection("queueTickets").findOne({ queueDate: todayKey(), barberId, status: "serving" });
  if (serving) {
    return { status: 409, error: `${barber.name} is still serving #${serving.queueNumber}. Complete that customer first.` };
  }

  return { barber };
}

function callFields(barber, user) {
  return {
    status: "serving",
    barberId: barber._id,
    barberName: barber.name,
    calledAt: new Date(),
    calledBy: user._id
  };
}

async function callTicket(res, db, filter, barber, user, notFound) {
  try {
    const ticket = await db.collection("queueTickets").findOneAndUpdate(
      filter,
      { $set: callFields(barber, user) },
      { sort: { appointmentPriority: -1, queueNumber: 1 }, returnDocument: "after" }
    );

    if (!ticket) return res.status(404).json({ error: notFound });
    if(ticket.appointmentId){
      const a=await db.collection('appointments').findOne({_id:ticket.appointmentId});
      if(a){try{const {notify}=require('./appointments');await notify(db,a,'called','Renz Barbershop: It is your turn',`Please proceed to ${barber.name} for your ${a.service} haircut. Queue number #${ticket.queueNumber}.`);}catch(error){console.error('Called customer notification failed:',error.message);}}
    }
    await audit(res.req, "queue.called", { queueNumber: ticket.queueNumber, customer: ticket.customerName, barber: barber.name });
    res.json(ticketView(ticket));
  } catch (error) {
    // The unique index allows only one customer being served per barber.
    if (error.code === 11000) return res.status(409).json({ error: `${barber.name} is already serving a customer.` });
    throw error;
  }
}

// ---------- Customers ----------

// Join the queue, signed in or as a guest.
router.post("/", joinLimiter, optionalAuth, async (req, res) => {
  const db = req.app.locals.db;

  if (req.user && req.user.role !== "customer") {
    return res.status(400).json({ error: "Staff add customers from the front desk." });
  }

  const isAccount = req.user?.role === "customer";
  const name = isAccount ? req.user.name : cleanText(req.body.name, 60);
  if (!validName(name)) return res.status(400).json({ error: "Enter your name (2 to 60 characters)." });

  const existing = await findOwnTicket(db, req);
  if (existing && ACTIVE.includes(existing.status)) {
    return res.status(409).json({ error: "You are already in today's queue." });
  }

  const waiting = await db.collection("queueTickets").countDocuments({ queueDate: todayKey(), status: { $in: WAITING } });
  if (waiting >= MAX_ONLINE_WAITING) {
    return res.status(503).json({ error: "The queue is full right now. Please ask at the counter." });
  }

  const { fields, error } = await readOrder(db, req.body);
  if (error) return res.status(400).json({ error });

  const ticket = await createTicket(db, {
    ...fields,
    customerName: name,
    customerId: isAccount ? req.user._id : null,
    source: isAccount ? "account" : "guest"
  });

  if (!isAccount) res.cookie("queueTicket", String(ticket._id), ticketCookie);

  await audit(req, "queue.joined", { queueNumber: ticket.queueNumber, customer: name, service: ticket.service });
  res.status(201).json({ ticket: { ...ticketView(ticket), ...await waitEstimate(db, ticket.queueNumber) } });
});

router.get("/mine", optionalAuth, async (req, res) => {
  const db = req.app.locals.db;
  const ticket = await findOwnTicket(db, req);

  if (!ticket || ticket.status === "cancelled") {
    return res.status(404).json({ error: "You have not joined today's queue." });
  }

  const estimate = WAITING.includes(ticket.status)
    ? await waitEstimate(db, ticket.queueNumber)
    : { peopleAhead: 0, estimatedMinutes: 0 };

  res.json({ ticket: { ...ticketView(ticket), ...estimate } });
});

router.post("/mine/leave", optionalAuth, async (req, res) => {
  const db = req.app.locals.db;
  const filter = ownTicketFilter(req);
  if (!filter) return res.status(404).json({ error: "You have not joined today's queue." });

  // Only cancel this customer's active, waiting ticket. Preserve the record
  // and queue number for history and to avoid re-issuing old queue numbers.
  const ticket = await db.collection("queueTickets").findOneAndUpdate(
    { ...filter, status: { $in: WAITING } },
    { $set: { status: "cancelled", endedAt: new Date() } },
    { sort: { createdAt: -1 } }
  );

  if (!ticket) return res.status(409).json({ error: "You are not waiting in the queue." });
  await audit(req, "queue.left", { queueNumber: ticket.queueNumber, customer: ticket.customerName });
  res.json({ message: "You have left the queue." });
});

// Match the total records on the customer's unfiltered My Visits page.
// That page includes waiting, completed and cancelled visits, not only completed ones.
router.get("/history/count", requireAuth, requireRole("customer"), async (req, res) => {
  const count = await req.app.locals.db.collection("queueTickets").countDocuments({
    customerId: req.user._id
  });
  res.json({ count });
});

// Customer-owned visit history. Legacy callers still receive the original 50-item array.
// Paginated callers can search, filter, and view older visits without a hard 50-record cutoff.
router.get("/history", requireAuth, requireRole("customer"), async (req, res) => {
  const db = req.app.locals.db;
  const collection = db.collection("queueTickets");
  const owner = { customerId: req.user._id };
  if (req.query.format !== "paginated") {
    const tickets = await collection.find(owner).sort({ createdAt: -1 }).limit(50).toArray();
    return res.json(tickets.map(t => ({ ...ticketView(t), queueDate: t.queueDate })));
  }

  const page = Number(req.query.page || 1);
  const pageSize = req.query.pageSize === "all" ? "all" : Number(req.query.pageSize || 10);
  if (!Number.isSafeInteger(page) || page < 1 || (pageSize !== "all" && ![10, 50, 100].includes(pageSize))) {
    return res.status(400).json({ error: "Invalid visit page or page size." });
  }
  const statuses = ["waiting", "assigned", "serving", "completed", "cancelled", "no-show", "expired"];
  const status = String(req.query.status || "all");
  if (status !== "all" && !statuses.includes(status)) return res.status(400).json({ error: "Invalid visit status." });
  if (status !== "all") owner.status = status === "waiting" ? { $in: ["waiting", "assigned"] } : status;
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !datePattern.test(from)) || (to && !datePattern.test(to)) || (from && to && from > to)) {
    return res.status(400).json({ error: "Choose a valid visit date range." });
  }
  if (from || to) owner.queueDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const search = String(req.query.search || "").trim();
  if (search.length > 80) return res.status(400).json({ error: "Search is too long." });
  if (search) {
    const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    owner.$or = [{ service: { $regex: pattern, $options: "i" } }, { barberName: { $regex: pattern, $options: "i" } }];
  }
  const sort = String(req.query.sort || "newest");
  if (!["newest", "oldest"].includes(sort)) return res.status(400).json({ error: "Invalid sort order." });
  const total = await collection.countDocuments(owner);
  const limit = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / limit));
  if (page > totalPages) return res.json({ visits: [], total, page, totalPages });
  const tickets = await collection.find(owner).sort({ createdAt: sort === "oldest" ? 1 : -1, _id: sort === "oldest" ? 1 : -1 })
    .skip(pageSize === "all" ? 0 : (page - 1) * limit).limit(limit).toArray();
  res.json({ visits: tickets.map(t => ({ ...ticketView(t), queueDate: t.queueDate })), total, page, totalPages });
});

// The queue screen shown in the shop: numbers and short names only.
router.get("/public", async (req, res) => {
  const db = req.app.locals.db;
  const tickets = await db.collection("queueTickets")
    .find({ queueDate: todayKey(), status: { $in: ACTIVE } })
    .sort({ queueNumber: 1 })
    .toArray();

  res.json({
    serving: tickets.filter(t => t.status === "serving").map(t => ({
      queueNumber: t.queueNumber,
      name: t.customerName ? shortName(t.customerName) : `Walk-in #${t.queueNumber}`,
      barberName: t.barberName
    })),
    waiting: tickets.filter(t => WAITING.includes(t.status)).map(t => ({
      queueNumber: t.queueNumber,
      name: t.customerName ? shortName(t.customerName) : `Walk-in #${t.queueNumber}`,
      service: t.service
    })),
    estimatedMinutes: (await waitEstimate(db)).estimatedMinutes
  });
});

// ---------- Front desk (cashier and admin) ----------

router.get("/", ...staffOnly, async (req, res) => {
  // Cancelled tickets stay in MongoDB for audit/history but must not appear
  // in the front desk's current-day queue list.
  const tickets = await req.app.locals.db.collection("queueTickets")
    .find({ queueDate: todayKey(), status: { $ne: "cancelled" } })
    .sort({ queueNumber: 1 })
    .toArray();

  res.json(tickets.map(ticketView));
});

// Today's full queue count includes cancelled tickets kept for audit/history.
router.get("/today/count", ...staffOnly, async (req, res) => {
  const count = await req.app.locals.db.collection("queueTickets").countDocuments({ queueDate: todayKey() });
  res.json({ count });
});

// Admin-only finalization: preserve all queue, payments and appointment history.
router.get("/today/closing", ...staffOnly, async (req, res) => {
  const closing = await req.app.locals.db.collection("dailyClosings").findOne({ _id: todayKey() });
  res.json({ closed: Boolean(closing), closing: closing ? { date: closing._id, closedAt: closing.closedAt, summary: closing.summary } : null });
});

router.post("/close-day", requireAuth, requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  const day = todayKey();
  const { startOfDay, addDays } = require("../utils/dates");
  const start = startOfDay(day), end = addDays(start, 1);
  const session = req.app.locals.mongoClient?.startSession();
  if (!session) return res.status(503).json({ error: "Database transactions are unavailable." });
  let summary;
  try {
    await session.withTransaction(async () => {
      // Serialize closing with same-date appointment creates and reschedules.
      await db.collection('bookingBatchLocks').updateOne(
        { _id: day }, { $inc: { version: 1 } }, { upsert: true, session }
      );
      // Atomic uniqueness prevents a second closing for the same day.
      if (await db.collection("dailyClosings").findOne({ _id: day }, { session })) {
        const error = new Error("Today's operations have already been closed."); error.status = 409; throw error;
      }
      const tickets = await db.collection("queueTickets").find({ queueDate: day }, { session }).toArray();
      const active = tickets.filter(t => ["waiting", "assigned", "serving"].includes(t.status));
      const unpaid = tickets.filter(t => t.status === "completed" && !t.paymentId && t.amountPaid == null);
      const checkedIn = await db.collection("appointments").countDocuments({ status: "checked-in", startsAt: { $gte: start, $lt: end } }, { session });
      if (active.length || unpaid.length || checkedIn) {
        const error = new Error(`Cannot close: ${active.length} active queue customer(s), ${unpaid.length} unpaid completed service(s), and ${checkedIn} checked-in appointment(s). Finish or resolve them first.`);
        error.status = 409; throw error;
      }
      const payments = await db.collection("payments").find({ createdAt: { $gte: start, $lt: end }, voided: { $ne: true } }, { session }).toArray();
      const total = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      summary = {
        totalCustomers: tickets.length,
        completedServices: tickets.filter(t => t.status === "completed").length,
        cancelled: tickets.filter(t => t.status === "cancelled").length,
        noShows: tickets.filter(t => t.status === "no-show").length,
        paymentsCount: payments.length,
        totalSales: Math.round(total * 100) / 100,
        serviceSales: Math.round(payments.filter(p => p.type !== "product").reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100) / 100,
        productSales: Math.round(payments.filter(p => p.type === "product").reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100) / 100
      };
      await db.collection("dailyClosings").insertOne({ _id: day, closedAt: new Date(), closedBy: req.user._id, summary }, { session });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 11000 || error.hasErrorLabel?.("TransientTransactionError")) return res.status(409).json({ error: "Closing status changed. Refresh and try again." });
    throw error;
  } finally { await session.endSession(); }
  try { await audit(req, "day.closed", { date: day, ...summary }); } catch (error) { console.error("Closing audit failed:", error.message); }
  res.json({ message: "Today's operations are closed. Daily records and future appointments were preserved.", date: day, summary });
});

// Add a walk-in customer, optionally linked to their account by email.
router.post("/walk-in", ...staffOnly, async (req, res) => {
  const db = req.app.locals.db;
  const email = cleanText(req.body.customerEmail, 254).toLowerCase();
  let customer = null;

  if (email) {
    customer = await db.collection("users").findOne({ email, role: "customer", active: { $ne: false } });
    if (!customer) return res.status(404).json({ error: "No customer account uses that email." });

    const active = await db.collection("queueTickets").findOne({
      customerId: customer._id,
      queueDate: todayKey(),
      status: { $in: ACTIVE }
    });
    if (active) return res.status(409).json({ error: `${customer.name} is already in the queue as #${active.queueNumber}.` });
  }

  const customerName = customer ? customer.name : cleanText(req.body.name, 60);
  if (customerName && !validName(customerName)) return res.status(400).json({ error: "Enter a valid name or leave it blank." });

  const { fields, error } = await readOrder(db, req.body);
  if (error) return res.status(400).json({ error });

  const ticket = await createTicket(db, {
    ...fields,
    customerName: customerName || null,
    customerId: customer ? customer._id : null,
    source: "walk-in",
    addedBy: req.user._id
  });

  await audit(req, "queue.walk-in", { queueNumber: ticket.queueNumber, customer: ticket.customerName, service: ticket.service });
  res.status(201).json(ticketView(ticket));
});

// Call the next customer for a barber: the first who chose that barber or has no preference.
router.post("/call-next", ...staffOnly, async (req, res) => {
  const db = req.app.locals.db;
  const { barber, status, error } = await freeBarber(db, req.body.barberId);
  if (error) return res.status(status).json({ error });

  await callTicket(
    res,
    db,
    { queueDate: todayKey(), status: { $in: WAITING }, preferredBarberId: { $in: [barber._id, null] } },
    barber,
    req.user,
    `No customers are waiting for ${barber.name}.`
  );
});

// Call a specific customer (for example, out of order) to a barber.
router.post("/:id/call", ...staffOnly, async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid ticket ID." });

  const { barber, status, error } = await freeBarber(db, req.body.barberId);
  if (error) return res.status(status).json({ error });

  await callTicket(
    res,
    db,
    { _id: id, queueDate: todayKey(), status: { $in: WAITING } },
    barber,
    req.user,
    "This customer is no longer waiting."
  );
});

// Finish a haircut without collecting payment. Only completed/unpaid tickets can be paid by Cashier.
// Keep the original /complete endpoint for backwards-compatible Admin workflows.
router.post("/:id/finish", ...staffOnly, async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid ticket ID." });
  const session = req.app.locals.mongoClient?.startSession();
  if (!session) return res.status(503).json({ error: "Database transaction is unavailable." });
  let ticket, appointment;
  try {
    await session.withTransaction(async () => {
      ticket = await db.collection("queueTickets").findOneAndUpdate(
        { _id: id, status: "serving" },
        { $set: { status: "completed", completedAt: new Date(), completedBy: req.user._id, paymentStatus: "unpaid" } },
        { returnDocument: "after", session }
      );
      if (!ticket) { const e = new Error("Only an in-service customer can be finished."); e.status = 409; throw e; }
      if (ticket.appointmentId) {
        appointment = await db.collection("appointments").findOneAndUpdate(
          { _id: ticket.appointmentId, status: "checked-in" },
          { $set: { status: "completed", completedAt: new Date() } },
          { session, returnDocument: "after" }
        );
        if (!appointment) { const e = new Error("Associated appointment cannot be completed."); e.status = 409; throw e; }
      }
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  } finally { await session.endSession(); }
  if (appointment) {
    try {
      const { notify } = require("./appointments");
      await notify(db, appointment, "completed", "Renz Barbershop: Service completed", `Your ${appointment.service} service is complete. Thank you for visiting!`);
    } catch (error) { console.error("Service completion notification failed:", error.message); }
  }
  const next = await db.collection("queueTickets").find({ queueDate: ticket.queueDate, status: { $in: WAITING }, preferredBarberId: { $in: [ticket.barberId, null] } }).sort({ appointmentPriority: -1, queueNumber: 1 }).limit(1).next();
  if (next?.appointmentId) {
    const a = await db.collection("appointments").findOne({ _id: next.appointmentId, status: "checked-in", barberId: ticket.barberId });
    if (a) { try { const { notify } = require("./appointments"); await notify(db, a, "next", "Renz Barbershop: You are next", `You are next for ${ticket.barberName}. Please wait for your queue number #${next.queueNumber}.`); } catch (error) { console.error("Next notice failed:", error.message); } }
  }
  try { await audit(req, "service.finished", { queueNumber: ticket.queueNumber, ticketId: String(ticket._id) }); } catch (error) { console.error("Finish service audit failed:", error.message); }
  res.json({ message: "Service completed. Payment is now pending.", ticket: ticketView(ticket) });
});

// Finish a visit and record the payment.
router.post("/:id/complete", ...staffOnly, async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid ticket ID." });

  const method = String(req.body.method || "").toLowerCase();
  if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: "Choose a payment method." });

  const current = await db.collection("queueTickets").findOne({ _id: id });
  if (!current) return res.status(404).json({ error: "Ticket not found." });

  // The customer may have had a different service than they joined for.
  let listPrice = Number(current.price) || 0;
  let serviceUpdate = {};
  if (req.body.serviceId) {
    const serviceId = toObjectId(req.body.serviceId);
    const service = serviceId && await db.collection("services").findOne({ _id: serviceId, active: { $ne: false } });
    if (!service) return res.status(400).json({ error: "Choose a valid service." });

    listPrice = service.price;
    if (!(current.serviceId && service._id.equals(current.serviceId))) {
      serviceUpdate = { serviceId: service._id, service: service.name, price: service.price, durationMinutes: service.durationMinutes };
    }
  }

  const rawAmount = req.body.amount;
  const amount = rawAmount === undefined || rawAmount === "" || rawAmount === null ? listPrice : Number(rawAmount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return res.status(400).json({ error: "Enter a valid amount." });

  // Charging less than the service price needs a reason, so discounts can be reviewed later.
  const note = cleanText(req.body.note, 200);
  const discount = Math.round(Math.max(0, listPrice - amount) * 100) / 100;
  if (discount > 0 && note.length < 3) {
    return res.status(400).json({ error: `The amount is ${discount} below the price. Enter a reason for the discount.` });
  }

  // Product usage is recorded in the same transaction as service completion and payment.
  const rawUsed = req.body.productsUsed ?? [];
  if (!Array.isArray(rawUsed) || rawUsed.length > 30) return res.status(400).json({error:"Invalid products used."});
  const productsUsed = [];
  const seen = new Set();
  for (const row of rawUsed) {
    const inventoryId = toObjectId(row.inventoryId), quantity = Number(row.quantity);
    if (!inventoryId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || seen.has(String(inventoryId))) return res.status(400).json({error:"Select valid products and quantities without duplicates."});
    seen.add(String(inventoryId));productsUsed.push({inventoryId,quantity});
  }
  const session = req.app.locals.mongoClient?.startSession();
  if (!session) return res.status(503).json({error:"Database transaction is unavailable."});
  let ticket,payment,paymentId,completedAppointment;
  try {
    await session.withTransaction(async()=>{
      ticket = await db.collection("queueTickets").findOneAndUpdate(
        {_id:id,status:"serving"},
        {$set:{status:"completed",completedAt:new Date(),completedBy:req.user._id,...serviceUpdate}},
        {returnDocument:"after",session}
      );
      if (!ticket) {const err=new Error("Only a customer who is being served can be completed.");err.status=409;throw err;}
      const usage=[];
      for(const row of productsUsed){
        const item=await db.collection("inventory").findOneAndUpdate(
          {_id:row.inventoryId,quantity:{$gte:row.quantity}},
          {$inc:{quantity:-row.quantity},$set:{updatedAt:new Date()}},
          {returnDocument:"after",session}
        );
        if(!item){const err=new Error("A product has insufficient stock or no longer exists.");err.status=409;throw err;}
        usage.push({inventoryId:row.inventoryId,name:item.name,unit:item.unit||"pcs",quantity:row.quantity});
        await db.collection("inventoryEvents").insertOne({inventoryId:row.inventoryId,type:"service-used",quantityChange:-row.quantity,ticketId:id,createdAt:new Date()},{session});
      }
      payment = {
        type:"service", ticketId:ticket._id,queueNumber:ticket.queueNumber,
        customerName:ticket.customerName,customerId:ticket.customerId||null,
        description:ticket.service,barberId:ticket.barberId,barberName:ticket.barberName,
        amount:Math.round(amount*100)/100,listPrice,discount,method,note,
        productsUsed:usage,cashierId:req.user._id,cashierName:req.user.name,createdAt:new Date()
      };
      const result=await db.collection("payments").insertOne(payment,{session});paymentId=result.insertedId;
      await db.collection("queueTickets").updateOne({_id:id},{$set:{paymentId:result.insertedId,amountPaid:payment.amount,productsUsed:usage}},{session});
      if(ticket.appointmentId){
        completedAppointment=await db.collection('appointments').findOneAndUpdate({_id:ticket.appointmentId,status:'checked-in'},{$set:{status:'completed',completedAt:new Date(),paymentId}},{session});
        if(!completedAppointment){const err=new Error('Associated appointment cannot be completed.');err.status=409;throw err;}
      }
    });
  }catch(err){
    if(err.status)return res.status(err.status).json({error:err.message});
    throw err;
  }finally{await session.endSession();}

  if(completedAppointment){
    try{const {notify}=require('./appointments');await notify(db,completedAppointment,'completed','Renz Barbershop: Service completed',`Your ${completedAppointment.service} service is complete. Thank you for visiting!`);}
    catch(error){console.error('Service completion notification failed:',error.message);}
  }
  // An actual queue transition, not a fixed timer, triggers a next-customer notice.
  // A barber has become free. Notify only the actual first eligible ticket,
  // and only when no other ticket is currently being served by that barber.
  const stillServing=await db.collection('queueTickets').findOne({queueDate:ticket.queueDate,status:'serving',barberId:ticket.barberId});
  const next=!stillServing?await db.collection('queueTickets').find({queueDate:ticket.queueDate,status:{$in:WAITING},preferredBarberId:{$in:[ticket.barberId,null]}}).sort({appointmentPriority:-1,queueNumber:1}).limit(1).next():null;
  if(next?.appointmentId){
    const a=await db.collection('appointments').findOne({_id:next.appointmentId,status:'checked-in',barberId:ticket.barberId});
    if(a){try{const {notify}=require('./appointments');await notify(db,a,'next','Renz Barbershop: You are next',`You are next for ${ticket.barberName}. Please wait for the cashier to call your queue number #${next.queueNumber}.`);}catch(error){console.error('Next customer notification failed:',error.message);}}
  }

  if (discount > 0) {
    await audit(req, "payment.discount", { queueNumber: ticket.queueNumber, customer: ticket.customerName, price: listPrice, charged: payment.amount, reason: note });
  }

  res.json({ message: "Visit completed and payment recorded.", ticket: ticketView({ ...ticket, amountPaid: payment.amount }) });
});

router.post("/:id/no-show", ...staffOnly, async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid ticket ID." });

  const ticket = await req.app.locals.db.collection("queueTickets").findOneAndUpdate(
    { _id: id, status: { $in: ACTIVE } },
    { $set: { status: "no-show", endedAt: new Date() } }
  );

  if (!ticket) return res.status(409).json({ error: "This customer is no longer in the queue." });
  if(ticket.appointmentId){
    const appointment=await req.app.locals.db.collection('appointments').findOneAndUpdate({_id:ticket.appointmentId,status:'checked-in'},{$set:{status:'no-show'}});
    if(appointment){const {notify}=require('./appointments');await notify(req.app.locals.db,appointment,'no-show','Renz Barbershop: Appointment missed','Your checked-in appointment was marked as no-show.');}
  }
  await audit(req, "queue.no-show", { queueNumber: ticket.queueNumber, customer: ticket.customerName });
  res.json({ message: `#${ticket.queueNumber} marked as no-show.` });
});

router.post("/:id/cancel", ...staffOnly, async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid ticket ID." });

  const ticket = await req.app.locals.db.collection("queueTickets").findOneAndUpdate(
    { _id: id, status: { $in: WAITING } },
    { $set: { status: "cancelled", endedAt: new Date() } }
  );

  if (!ticket) return res.status(409).json({ error: "Only waiting customers can be cancelled." });
  if(ticket.appointmentId){
    const db=req.app.locals.db;
    const appointment=await db.collection('appointments').findOneAndUpdate({_id:ticket.appointmentId,status:'checked-in'},{$set:{status:'cancelled',cancelledAt:new Date()}});
    if(appointment){await db.collection('appointmentSlots').deleteMany({appointmentId:appointment._id});const {notify}=require('./appointments');await notify(db,appointment,'cancelled','Renz Barbershop: Appointment cancelled','Your checked-in appointment was cancelled.');}
  }
  await audit(req, "queue.cancelled", { queueNumber: ticket.queueNumber, customer: ticket.customerName });
  res.json({ message: `#${ticket.queueNumber} cancelled.` });
});

router.delete("/", requireAuth, requireRole("admin"), async (req, res) => {
  res.status(410).json({ error: "The legacy bulk queue cancellation was disabled. Use End of Day after all active visits and payments are resolved." });
});

module.exports = router;
