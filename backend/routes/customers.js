const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { sendPasswordReset } = require("../utils/mailer");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText, validEmail, validName, toObjectId, escapeRegex } = require("../utils/validation");

const { audit } = require("../utils/security");
const { dateKey, addDays } = require("../utils/dates");

const router = express.Router();
router.use(requireAuth, requireRole("admin", "cashier"));

function visitView(t) {
  return {
    id: String(t._id),
    queueDate: t.queueDate,
    queueNumber: t.queueNumber,
    customerName: t.customerName,
    service: t.service,
    barberName: t.barberName || null,
    status: t.status === "assigned" ? "waiting" : t.status,
    amountPaid: t.amountPaid ?? null,
    source: t.source || "guest",
    createdAt: t.createdAt || null
  };
}

// Customer accounts, newest first, with visit counts. Optional ?search= by name, email or phone.
router.get("/", async (req, res) => {
  const db = req.app.locals.db;
  const search = cleanText(req.query.search, 60);
  const filter = { role: "customer", deletedAt: { $exists: false } };

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }

  const customers = await db.collection("users")
    .find(filter, { projection: { passwordHash: 0 } })
    .sort({ createdAt: -1 })
    .limit(1000)
    .toArray();

  const visits = await db.collection("queueTickets").aggregate([
    { $match: { customerId: { $in: customers.map(c => c._id) }, status: "completed" } },
    { $group: { _id: "$customerId", visits: { $sum: 1 }, lastVisit: { $max: "$queueDate" }, spent: { $sum: { $ifNull: ["$amountPaid", 0] } } } }
  ]).toArray();
  const visitMap = new Map(visits.map(v => [String(v._id), v]));

  res.json(customers.map(c => {
    const v = visitMap.get(String(c._id));
    return {
      id: String(c._id),
      name: c.name,
      email: c.email,
      phone: c.phone || "",
      photoUrl: c.photoUrl || "",
      active: c.active !== false,
      createdAt: c.createdAt,
      visits: v ? v.visits : 0,
      lastVisit: v ? v.lastVisit : null,
      spent: v ? v.spent : 0
    };
  }));
});

// Walk-in visits without an account in the last 30 days.
router.get("/walk-ins", async (req, res) => {
  const since = dateKey(addDays(new Date(), -30));
  const tickets = await req.app.locals.db.collection("queueTickets")
    .find({ customerId: null, queueDate: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  res.json(tickets.map(visitView));
});

// Cashier-assisted registration: no staff-visible password. The customer completes
// account setup using a single-use, short-lived link sent to their own email.
router.post("/", async (req, res) => {
  const db = req.app.locals.db;
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const phone = cleanText(req.body.phone, 20);
  const ticketId = req.body.ticketId ? toObjectId(req.body.ticketId) : null;
  if (req.body.consent !== true) return res.status(400).json({ error: "Confirm the customer agreed to register." });
  if (!validName(name)) return res.status(400).json({ error: "Enter the customer's name (2 to 60 characters)." });
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (req.body.ticketId && !ticketId) return res.status(400).json({ error: "Invalid visit." });
  if (await db.collection("users").findOne({ email })) return res.status(409).json({ error: "An account with this email already exists." });
  // The record must still be unlinked; do not adopt a ticket using a matching name alone.
  if (ticketId && !await db.collection("queueTickets").findOne({ _id: ticketId, customerId: null, source: "walk-in" })) {
    return res.status(409).json({ error: "This walk-in visit is no longer available for account linking." });
  }
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const base = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  let setupUrl;
  try {
    const url = new URL("/forgot-password.html", base);
    if (!["https:", "http:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw new Error("Invalid origin");
    url.searchParams.set("token", rawToken);
    setupUrl = url.toString();
  } catch {
    return res.status(503).json({ error: "Account setup is unavailable. Configure APP_BASE_URL." });
  }
  const now = new Date();
  const randomPassword = crypto.randomBytes(48).toString("base64url");
  let id;
  try {
    const result = await db.collection("users").insertOne({
      name, email, phone, passwordHash: await bcrypt.hash(randomPassword, 12),
      role: "customer", active: true, emailVerified: false, mustChangePassword: true,
      pendingWalkInTicketId: ticketId || null, sessionVersion: 0,
      createdBy: req.user._id, createdAt: now, updatedAt: now
    });
    id = result.insertedId;
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with this email already exists." });
    throw error;
  }
  try {
    await db.collection("passwordResetTokens").insertOne({ tokenHash, userId: id, createdAt: now, expiresAt: new Date(now.getTime() + 15 * 60 * 1000) });
    await sendPasswordReset(email, setupUrl);
  } catch (error) {
    await db.collection("passwordResetTokens").deleteMany({ userId: id });
    await db.collection("users").deleteOne({ _id: id, emailVerified: false });
    console.error("[Customer Setup] Sending invitation failed:", error.code || error.message);
    return res.status(503).json({ error: "Unable to email the account setup link. Please try again." });
  }
  await audit(req, "customer.invited", { customer: name, email });
  res.status(201).json({ id: String(id), message: "Account setup link sent to the customer's email. The customer must create their password within 15 minutes." });
});

// ADMIN: turn a customer account off (for example, abuse) or back on.
router.patch("/:id", requireRole("admin"), async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid customer ID." });
  if (typeof req.body.active !== "boolean") return res.status(400).json({ error: "Active must be true or false." });

  const customer = await req.app.locals.db.collection("users").findOneAndUpdate(
    { _id: id, role: "customer", deletedAt: { $exists: false } },
    { $set: { active: req.body.active, updatedAt: new Date() }, $inc: { sessionVersion: 1 } }
  );

  if (!customer) return res.status(404).json({ error: "Customer not found." });
  await audit(req, req.body.active ? "customer.activated" : "customer.deactivated", { customer: customer.name });
  res.json({ message: req.body.active ? "Account activated." : "Account deactivated." });
});

router.get("/:id/visits", async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid customer ID." });

  const tickets = await req.app.locals.db.collection("queueTickets")
    .find({ customerId: id })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  res.json(tickets.map(visitView));
});

router.post("/:id/reset-password", requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid customer ID." });

  const password = crypto.randomBytes(16).toString("base64url");
  const customer = await db.collection("users").findOneAndUpdate(
    { _id: id, role: "customer", active: { $ne: false } },
    {
      $set: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, updatedAt: new Date() },
      $inc: { sessionVersion: 1 }
    }
  );

  if (!customer) return res.status(404).json({ error: "Customer not found." });
  await audit(req, "customer.password-reset", { customer: customer.name });
  res.json({ temporaryPassword: password });
});

module.exports = router;
