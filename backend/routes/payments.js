const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText, toObjectId } = require("../utils/validation");
const { todayKey, validDateKey, startOfDay, addDays } = require("../utils/dates");
const { audit } = require("../utils/security");

const router = express.Router();
const staffOnly = [requireAuth, requireRole("admin", "cashier")];
const PAYMENT_METHODS = ["cash", "gcash", "card", "other"];

function paymentView(p) {
  return {
    id: String(p._id),
    type: p.type,
    description: p.description,
    customerName: p.customerName || null,
    queueNumber: p.queueNumber ?? null,
    barberName: p.barberName || null,
    quantity: p.quantity ?? null,
    amount: p.amount,
    listPrice: p.listPrice ?? null,
    discount: p.discount || 0,
    note: p.note || "",
    method: p.method,
    cashierName: p.cashierName,
    createdAt: p.createdAt,
    voided: p.voided === true,
    voidReason: p.voidReason || "",
    voidedByName: p.voidedByName || "",
    replacesPaymentId: p.replacesPaymentId ? String(p.replacesPaymentId) : null
  };
}

// Payments between two dates (inclusive), with totals. Voided payments are listed but not counted.
router.get("/", ...staffOnly, async (req, res) => {
  const from = req.query.from || todayKey();
  const to = req.query.to || from;

  if (!validDateKey(from) || !validDateKey(to) || from > to) {
    return res.status(400).json({ error: "Choose a valid date range." });
  }

  const start = startOfDay(from);
  const end = addDays(startOfDay(to), 1);
  if (end - start > 367 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: "Choose a range of one year or less." });

  const payments = await req.app.locals.db.collection("payments")
    .find({ createdAt: { $gte: start, $lt: end } })
    .sort({ createdAt: -1 })
    .toArray();

  const totals = {
    count: 0,
    total: 0,
    services: 0,
    products: 0,
    discounts: 0,
    voided: 0,
    byMethod: { cash: 0, gcash: 0, card: 0, other: 0 }
  };

  for (const p of payments) {
    if (p.voided) {
      totals.voided += 1;
      continue;
    }
    totals.count += 1;
    totals.total += p.amount;
    totals.discounts += p.discount || 0;
    totals[p.type === "product" ? "products" : "services"] += p.amount;
    totals.byMethod[p.method] = (totals.byMethod[p.method] || 0) + p.amount;
  }

  // Include profile photos for linked customer accounts only; product sales and guests use the UI fallback.
  const ids = [...new Map(payments.filter(p => p.customerId).map(p => [String(p.customerId), p.customerId])).values()];
  const customers = ids.length ? await req.app.locals.db.collection("users").find(
    { _id: { $in: ids }, role: "customer" }, { projection: { photoUrl: 1 } }
  ).toArray() : [];
  const photos = new Map(customers.map(c => [String(c._id), c.photoUrl || ""]));
  res.json({ from, to, totals, payments: payments.map(p => ({
    ...paymentView(p), customerPhotoUrl: p.customerId ? photos.get(String(p.customerId)) || "" : ""
  })) });
});

// Cashier confirms payment only for a completed service not previously paid.
// Ticket update and payment insert share one MongoDB transaction to prevent double charges.
router.post("/service/:ticketId/pay", ...staffOnly, async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.ticketId);
  if (!id) return res.status(400).json({ error: "Invalid ticket ID." });
  const method = String(req.body.method || "").toLowerCase();
  if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: "Choose a payment method." });
  const current = await db.collection("queueTickets").findOne({ _id: id });
  if (!current) return res.status(404).json({ error: "Service not found." });
  if (current.status !== "completed" || current.paymentId || current.amountPaid != null) return res.status(409).json({ error: "This service is not awaiting payment or has already been paid." });
  const listPrice = Number(current.price);
  if (!Number.isFinite(listPrice) || listPrice < 0) return res.status(409).json({ error: "Service price is invalid. Contact the administrator." });
  const amount = req.body.amount === undefined || req.body.amount === "" ? listPrice : Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return res.status(400).json({ error: "Enter a valid payment amount." });
  const note = cleanText(req.body.note, 200);
  const discount = Math.round(Math.max(0, listPrice - amount) * 100) / 100;
  if (discount > 0 && note.length < 3) return res.status(400).json({ error: "Please enter a reason for the discount." });
  const payment = {
    type: "service", ticketId: id, queueNumber: current.queueNumber,
    customerName: current.customerName, customerId: current.customerId || null,
    description: current.service, barberId: current.barberId, barberName: current.barberName,
    amount: Math.round(amount * 100) / 100, listPrice, discount, method, note,
    cashierId: req.user._id, cashierName: req.user.name, createdAt: new Date()
  };
  const session = req.app.locals.mongoClient?.startSession();
  if (!session) return res.status(503).json({ error: "Database transaction is unavailable." });
  let paymentId;
  try {
    await session.withTransaction(async () => {
      const locked = await db.collection("queueTickets").findOneAndUpdate(
        { _id: id, status: "completed", paymentId: { $exists: false }, amountPaid: { $exists: false } },
        { $set: { paymentStatus: "processing", paymentProcessingAt: new Date() } },
        { session, returnDocument: "after" }
      );
      // Older unpaid records may have explicit null values; permit those too.
      const candidate = locked || await db.collection("queueTickets").findOneAndUpdate(
        { _id: id, status: "completed", paymentId: null, amountPaid: null, paymentStatus: { $ne: "paid" } },
        { $set: { paymentStatus: "processing", paymentProcessingAt: new Date() } },
        { session, returnDocument: "after" }
      );
      if (!candidate) { const e = new Error("Payment has already been processed or the service is not eligible."); e.status = 409; throw e; }
      const inserted = await db.collection("payments").insertOne(payment, { session });
      paymentId = inserted.insertedId;
      await db.collection("queueTickets").updateOne({ _id: id }, { $set: { paymentId, amountPaid: payment.amount, paymentStatus: "paid", paidAt: payment.createdAt }, $unset: { paymentProcessingAt: "" } }, { session });
      if (current.appointmentId) await db.collection("appointments").updateOne({ _id: current.appointmentId }, { $set: { paymentId } }, { session });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 112 || error.hasErrorLabel?.("TransientTransactionError")) return res.status(409).json({ error: "Payment is being processed. Refresh before retrying." });
    throw error;
  } finally { await session.endSession(); }
  try {
    if (discount > 0) await audit(req, "payment.discount", { queueNumber: current.queueNumber, price: listPrice, charged: payment.amount, reason: note });
    await audit(req, "payment.collected", { ticketId: String(id), paymentId: String(paymentId), amount: payment.amount });
  } catch (error) { console.error("Payment audit failed:", error.message); }
  res.status(201).json({ message: "Payment recorded successfully.", payment: paymentView({ _id: paymentId, ...payment }) });
});

// Sell products from inventory at the counter.
router.post("/product-sale", ...staffOnly, async (req, res) => {
  const db = req.app.locals.db;
  const inventoryId = toObjectId(req.body.inventoryId);
  const quantity = Number(req.body.quantity);
  const method = String(req.body.method || "").toLowerCase();

  if (!inventoryId) return res.status(400).json({ error: "Choose a product." });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return res.status(400).json({ error: "Enter a quantity of 1 or more." });
  if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: "Choose a payment method." });

  // Take the stock in one step so two sales can't sell the same last item.
  const item = await db.collection("inventory").findOneAndUpdate(
    { _id: inventoryId, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" }
  );

  if (!item) {
    const exists = await db.collection("inventory").findOne({ _id: inventoryId });
    return exists
      ? res.status(409).json({ error: `Only ${exists.quantity} ${exists.name} left in stock.` })
      : res.status(404).json({ error: "Product not found." });
  }

  await db.collection("inventoryEvents").insertOne({
    inventoryId,
    type: "sold",
    quantityChange: -quantity,
    createdAt: new Date()
  });

  const payment = {
    type: "product",
    inventoryId,
    description: item.name,
    quantity,
    amount: Math.round(item.price * quantity * 100) / 100,
    listPrice: Math.round(item.price * quantity * 100) / 100,
    discount: 0,
    method,
    cashierId: req.user._id,
    cashierName: req.user.name,
    createdAt: new Date()
  };

  const result = await db.collection("payments").insertOne(payment);

  await audit(req, "payment.product-sale", { product: item.name, quantity, amount: payment.amount, paymentId: String(result.insertedId) });
  res.status(201).json({
    message: `Sold ${quantity} × ${item.name}.`,
    payment: paymentView({ _id: result.insertedId, ...payment }),
    remainingStock: item.quantity
  });
});

// ADMIN: void a payment recorded by mistake, with a reason. Optionally record the corrected payment.
// Product sales go back into stock.
router.post("/:id/void", requireAuth, requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid payment ID." });

  const reason = cleanText(req.body.reason, 200);
  if (reason.length < 3) return res.status(400).json({ error: "Enter a reason for voiding this payment." });

  const hasReplacement = req.body.replacementAmount !== undefined && req.body.replacementAmount !== "" && req.body.replacementAmount !== null;
  const replacementAmount = Number(req.body.replacementAmount);
  const replacementMethod = String(req.body.replacementMethod || "").toLowerCase();

  if (hasReplacement) {
    if (!Number.isFinite(replacementAmount) || replacementAmount < 0 || replacementAmount > 100000) {
      return res.status(400).json({ error: "Enter a valid corrected amount." });
    }
    if (!PAYMENT_METHODS.includes(replacementMethod)) return res.status(400).json({ error: "Choose the corrected payment method." });
  }

  const payment = await db.collection("payments").findOneAndUpdate(
    { _id: id, voided: { $ne: true } },
    { $set: { voided: true, voidReason: reason, voidedBy: req.user._id, voidedByName: req.user.name, voidedAt: new Date() } }
  );

  if (!payment) return res.status(409).json({ error: "This payment was not found or is already voided." });

  if (payment.type === "product" && payment.inventoryId) {
    await db.collection("inventory").updateOne({ _id: payment.inventoryId }, { $inc: { quantity: payment.quantity } });
    await db.collection("inventoryEvents").insertOne({
      inventoryId: payment.inventoryId,
      type: "returned",
      quantityChange: payment.quantity,
      createdAt: new Date()
    });
  }

  let replacement = null;
  if (hasReplacement) {
    const { _id, voided, voidReason, voidedBy, voidedByName, voidedAt, ...original } = payment;
    replacement = {
      ...original,
      amount: Math.round(replacementAmount * 100) / 100,
      discount: Math.round(Math.max(0, (payment.listPrice ?? replacementAmount) - replacementAmount) * 100) / 100,
      method: replacementMethod,
      note: `Correction: ${reason}`,
      replacesPaymentId: payment._id,
      cashierId: req.user._id,
      cashierName: req.user.name,
      createdAt: new Date()
    };
    const result = await db.collection("payments").insertOne(replacement);
    replacement._id = result.insertedId;
  }

  if (payment.ticketId) {
    await db.collection("queueTickets").updateOne(
      { _id: payment.ticketId },
      { $set: { amountPaid: replacement ? replacement.amount : 0, paymentId: replacement ? replacement._id : null } }
    );
  }

  await audit(req, "payment.voided", {
    description: payment.description,
    amount: payment.amount,
    method: payment.method,
    reason,
    correctedAmount: replacement?.amount ?? null,
    correctedMethod: replacement?.method ?? null
  });

  res.json({ message: replacement ? "Payment voided and the corrected payment recorded." : "Payment voided." });
});

module.exports = router;
