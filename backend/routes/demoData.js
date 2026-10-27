"use strict";
// Admin-controlled, tagged sample records. Never touch untagged production records.
const express = require("express");
const { ObjectId } = require("mongodb");
const { requireAuth, requireRole } = require("../middleware/auth");
const { todayKey, startOfDay, addDays, dateKey } = require("../utils/dates");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("crypto");
const router = express.Router();
router.use(requireAuth, requireRole("admin"));
const STATE_ID = "renz-analytics-dummy-data-v1";
const COLLECTIONS = ["users", "queueTickets", "appointments", "payments"];
const FIRST = ["Juan", "Maria", "Jose", "Ana", "Miguel", "Sofia", "Carlo", "Isabel", "Paolo", "Bianca", "Luis", "Camille", "Rafael", "Angela", "Marco", "Jasmine", "Daniel", "Kristine", "Gabriel", "Nicole"];
const LAST = ["Santos", "Reyes", "Cruz", "Garcia", "Mendoza", "Ramos", "Flores", "Torres", "Bautista", "Aquino", "Navarro", "Castillo", "Rivera", "Villanueva", "Fernandez"];
const pick = (array, n) => array[n % array.length];
const status = async db => {
  const state = await db.collection("demoDataState").findOne({ _id: STATE_ID });
  const counts = await Promise.all(COLLECTIONS.map(name => db.collection(name).countDocuments({ demoBatchId: STATE_ID })));
  return { enabled: counts.some(Boolean), counts: Object.fromEntries(COLLECTIONS.map((name, i) => [name, counts[i]])), updatedAt: state?.updatedAt || null };
};
router.get("/status", async (req, res) => { try { res.json(await status(req.app.locals.db)); } catch (error) { console.error("Demo status:", error); res.status(500).json({ error: "Unable to check dummy data status." }); } });
router.post("/enable", async (req, res) => {
  const db = req.app.locals.db;
  const session = req.app.locals.mongoClient?.startSession();
  if (!session) return res.status(503).json({ error: "Database transactions are unavailable." });
  try {
    await session.withTransaction(async () => {
      const existing = await db.collection("demoDataState").findOne({ _id: STATE_ID }, { session });
      if (existing?.enabled) return;
      // Existing demo records, if present, must not be duplicated.
      if (await db.collection("queueTickets").countDocuments({ demoBatchId: STATE_ID }, { session })) {
        await db.collection("demoDataState").updateOne({ _id: STATE_ID }, { $set: { enabled: true, updatedAt: new Date() } }, { upsert: true, session });
        return;
      }
      const [barbers, services] = await Promise.all([
        db.collection("barbers").find({ active: true }, { session }).sort({ createdAt: 1, _id: 1 }).limit(3).toArray(),
        db.collection("services").find({ active: { $ne: false } }, { session }).sort({ name: 1 }).toArray()
      ]);
      if (!barbers.length || !services.length) { const e = new Error("Add at least one active barber and one active service before enabling dummy data."); e.status = 409; throw e; }
      const now = new Date();
      const hash = await bcrypt.hash(randomBytes(28).toString("hex"), 10);
      const customerDocs = Array.from({ length: 64 }, (_, i) => ({
        _id: new ObjectId(), name: `${pick(FIRST, i * 7 + Math.floor(i / 20))} ${pick(LAST, i * 11 + Math.floor(i / 15))}`,
        email: `renz-demo-${String(i + 1).padStart(3, "0")}@example.invalid`, passwordHash: hash,
        role: "customer", active: true, sessionVersion: 0, demoBatchId: STATE_ID, createdAt: addDays(now, -(i * 3 + 30)), updatedAt: now
      }));
      const tickets = [], payments = [], appointments = [];
      // Historical dates: avoid today's live queue and real appointment availability.
      // Allocate unused daily queue numbers; never collide with actual tickets.
      const base = startOfDay(todayKey());
      const dailyNext = new Map();
      for (let i = 0; i < 240; i++) {
        const date = addDays(base, -(1 + (i * 17) % 330));
        const day = dateKey(date);
        if (!dailyNext.has(day)) {
          const last = await db.collection("queueTickets").find({ queueDate: day }, { session }).sort({ queueNumber: -1 }).limit(1).next();
          dailyNext.set(day, (Number(last?.queueNumber) || 0) + 1);
        }
        const queueNumber = dailyNext.get(day);
        dailyNext.set(day, queueNumber + 1);
        const createdAt = new Date(date.getTime() + (9 * 60 + (i * 37) % 570) * 60000);
        const barber = pick(barbers, i * 7 + Math.floor(i / 3));
        const service = pick(services, i * 13 + Math.floor(i / 7));
        const customer = pick(customerDocs, i * 19 + Math.floor(i / 64));
        const isBooking = i % 4 === 0;
        const isCompleted = i % 13 !== 0;
        const calledAt = isCompleted ? new Date(createdAt.getTime() + (6 + (i * 7) % 29) * 60000) : null;
        const completedAt = calledAt ? new Date(calledAt.getTime() + (Number(service.durationMinutes) || 30) * 60000) : null;
        const ticketId = new ObjectId();
        const appointmentId = isBooking ? new ObjectId() : null;
        const paymentId = isCompleted ? new ObjectId() : null;
        const price = Number(service.price) || 0;
        tickets.push({ _id: ticketId, demoBatchId: STATE_ID, queueDate: day, queueNumber,
          customerId: customer._id, customerName: customer.name, serviceId: service._id, service: service.name,
          price, durationMinutes: Number(service.durationMinutes) || 30, preferredBarberId: barber._id,
          preferredBarberName: barber.name, barberId: isCompleted ? barber._id : null,
          barberName: isCompleted ? barber.name : null, source: isBooking ? "appointment" : "walkin",
          appointmentId, status: isCompleted ? "completed" : "cancelled", createdAt, calledAt, completedAt,
          ...(isCompleted ? { paymentId, amountPaid: price, paymentStatus: "paid" } : {}) });
        if (isCompleted) payments.push({ _id: paymentId, demoBatchId: STATE_ID, type: "service", ticketId,
          queueNumber, customerId: customer._id, customerName: customer.name, description: service.name,
          barberId: barber._id, barberName: barber.name, amount: price, listPrice: price, discount: 0,
          method: pick(["cash", "cash", "gcash", "gcash", "card"], i), note: "",
          cashierId: req.user._id, cashierName: req.user.name || "Admin", createdAt: completedAt });
        if (appointmentId) appointments.push({ _id: appointmentId, demoBatchId: STATE_ID,
          customerId: customer._id, customerName: customer.name, customerEmail: customer.email,
          barberId: barber._id, barberName: barber.name, serviceId: service._id, service: service.name,
          services: [{ serviceId: service._id, name: service.name, price, durationMinutes: Number(service.durationMinutes) || 30 }],
          price, durationMinutes: Number(service.durationMinutes) || 30, startsAt: createdAt,
          endsAt: completedAt || new Date(createdAt.getTime() + (Number(service.durationMinutes) || 30) * 60000),
          status: isCompleted ? "completed" : "cancelled", method: "cash", createdAt: addDays(createdAt, -2),
          ...(isCompleted ? { completedAt, paymentId } : {}) });
      }
      await db.collection("users").insertMany(customerDocs, { session });
      await db.collection("queueTickets").insertMany(tickets, { session });
      await db.collection("payments").insertMany(payments, { session });
      if (appointments.length) await db.collection("appointments").insertMany(appointments, { session });
      await db.collection("demoDataState").updateOne({ _id: STATE_ID }, { $set: { enabled: true, updatedAt: now } }, { upsert: true, session });
    });
    res.json(await status(db));
  } catch (error) { console.error("Enable dummy data:", error); res.status(error.status || 500).json({ error: error.status ? error.message : "Could not generate dummy data. No production records were removed." }); }
  finally { await session.endSession(); }
});
router.post("/disable", async (req, res) => {
  const db = req.app.locals.db;
  const session = req.app.locals.mongoClient?.startSession();
  if (!session) return res.status(503).json({ error: "Database transactions are unavailable." });
  try {
    await session.withTransaction(async () => {
      // Deletion is restricted to this generator's explicit batch marker.
      for (const collection of ["payments", "appointments", "queueTickets", "users"]) {
        await db.collection(collection).deleteMany({ demoBatchId: STATE_ID }, { session });
      }
      await db.collection("demoDataState").updateOne({ _id: STATE_ID }, { $set: { enabled: false, updatedAt: new Date() } }, { upsert: true, session });
    });
    res.json(await status(db));
  } catch (error) { console.error("Disable dummy data:", error); res.status(500).json({ error: "Could not remove dummy data. Try again." }); }
  finally { await session.endSession(); }
});
module.exports = router;
