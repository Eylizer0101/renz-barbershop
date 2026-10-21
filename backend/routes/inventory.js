const express = require("express");
const { ObjectId } = require("mongodb");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText, positiveNumber } = require("../utils/validation");
const { audit } = require("../utils/security");

const router = express.Router();

router.get("/", requireAuth, requireRole("admin", "cashier"), async (req, res) => {
  const db = req.app.locals.db;
  const items = await db.collection("inventory").find(req.user.role === "admin" ? {} : { active: { $ne: false } }).sort({ name: 1 }).toArray();
  res.json(items.map(i => ({
    ...i,
    id: String(i._id),
    _id: undefined,
    unit: i.unit || "pcs",
    active: i.active !== false,
    unitCost: Number(i.unitCost || 0),
    supplier: i.supplier || "",
    lowStock: i.quantity <= i.minimumStock
  })));
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  const name = cleanText(req.body.name, 100);
  const category = cleanText(req.body.category, 60);
  const quantity = Number(req.body.quantity);
  const minimumStock = Number(req.body.minimumStock);
  const price = Number(req.body.price);
  const unit = cleanText(req.body.unit || 'pcs', 20);
  const unitCost = Number(req.body.unitCost ?? 0);
  const supplier = cleanText(req.body.supplier, 100);
  if (!/^(pcs|g|ml|bottles|boxes|packs|jars|cans)$/.test(unit)) return res.status(400).json({error:'Choose a valid stock unit.'});

  if (name.length < 2) return res.status(400).json({ error: "Product name is required." });
  if (!positiveNumber(quantity) || !Number.isInteger(quantity)) return res.status(400).json({ error: "Quantity must be a whole number >= 0." });
  if (!positiveNumber(minimumStock) || !Number.isInteger(minimumStock)) return res.status(400).json({ error: "Minimum stock must be a whole number >= 0." });
  if (!positiveNumber(price)) return res.status(400).json({ error: "Price must be >= 0." });
  if (!Number.isFinite(unitCost) || unitCost < 0) return res.status(400).json({ error: "Unit cost must be >= 0." });

  const doc = {
    name, category, quantity, minimumStock, price, unit, unitCost, supplier, active: true,
    createdAt: new Date(), updatedAt: new Date()
  };
  const result = await db.collection("inventory").insertOne(doc);

  // Monthly analytics event
  await db.collection("inventoryEvents").insertOne({
    inventoryId: result.insertedId,
    type: "created",
    quantityChange: quantity,
    createdAt: new Date()
  });

  await audit(req, "inventory.created", { product: name, quantity, price });
  res.status(201).json({ id: String(result.insertedId), ...doc });
});

router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid product ID." });
  const id = new ObjectId(req.params.id);
  const current = await db.collection("inventory").findOne({ _id: id });
  if (!current) return res.status(404).json({ error: "Product not found." });

  const name = cleanText(req.body.name, 100);
  const category = cleanText(req.body.category, 60);
  const quantity = Number(req.body.quantity);
  const minimumStock = Number(req.body.minimumStock);
  const price = Number(req.body.price);
  const unit = cleanText(req.body.unit || 'pcs', 20);
  const unitCost = Number(req.body.unitCost ?? 0);
  const supplier = cleanText(req.body.supplier, 100);
  if (!/^(pcs|g|ml|bottles|boxes|packs|jars|cans)$/.test(unit)) return res.status(400).json({error:'Choose a valid stock unit.'});

  if (name.length < 2 || !Number.isInteger(quantity) || quantity < 0 ||
      !Number.isInteger(minimumStock) || minimumStock < 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(unitCost) || unitCost < 0) {
    return res.status(400).json({ error: "Invalid inventory values." });
  }

  await db.collection("inventory").updateOne(
    { _id: id },
    { $set: { name, category, quantity, minimumStock, price, unit, unitCost, supplier, updatedAt: new Date() } }
  );

  await db.collection("inventoryEvents").insertOne({
    inventoryId: id,
    type: "updated",
    quantityChange: quantity - current.quantity,
    createdAt: new Date()
  });

  await audit(req, "inventory.updated", { product: name, quantityBefore: current.quantity, quantityAfter: quantity, price });
  res.json({ message: "Inventory updated." });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid product ID." });
  const id = new ObjectId(req.params.id);
  const current = await db.collection("inventory").findOneAndDelete({ _id: id });
  if (!current) return res.status(404).json({ error: "Product not found." });

  await db.collection("inventoryEvents").insertOne({
    inventoryId: id,
    type: "deleted",
    quantityChange: -current.quantity,
    createdAt: new Date()
  });

  await audit(req, "inventory.deleted", { product: current.name, quantity: current.quantity });
  res.json({ message: "Inventory item deleted." });
});


// Admin-only stock movement; the database condition prevents stock from becoming negative.
router.post("/:id/stock", requireAuth, requireRole("admin"), async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid product ID." });
  const db = req.app.locals.db;
  const id = new ObjectId(req.params.id);
  const direction = req.body.type;
  const amount = Number(req.body.quantity);
  const reason = cleanText(req.body.reason, 200);
  if (!["in", "out"].includes(direction) || !Number.isInteger(amount) || amount < 1 || amount > 100000)
    return res.status(400).json({ error: "Choose Stock In or Stock Out and a valid quantity." });
  if (direction === "out" && !reason) return res.status(400).json({ error: "Enter a reason for stock out." });
  const delta = direction === "in" ? amount : -amount;
  const filter = { _id: id, active: { $ne: false }, ...(delta < 0 ? { quantity: { $gte: amount } } : {}) };
  const previous = await db.collection("inventory").findOneAndUpdate(filter, { $inc: { quantity: delta }, $set: { updatedAt: new Date() } }, { returnDocument: "before" });
  if (!previous) return res.status(409).json({ error: "Product is archived, missing, or has insufficient stock." });
  await db.collection("inventoryEvents").insertOne({ inventoryId: id, type: direction === "in" ? "stock-in" : "stock-out", quantityChange: delta, reason, actorName: req.user.name || "Admin", createdAt: new Date() });
  await audit(req, direction === "in" ? "inventory.stock-in" : "inventory.stock-out", { product: previous.name, quantityBefore: previous.quantity, quantityAfter: previous.quantity + delta, reason });
  res.json({ message: "Stock updated.", quantity: previous.quantity + delta });
});

router.get("/:id/history", requireAuth, requireRole("admin"), async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid product ID." });
  const events = await req.app.locals.db.collection("inventoryEvents").find({ inventoryId: new ObjectId(req.params.id) }).sort({ createdAt: -1 }).limit(100).toArray();
  res.json(events.map(e => ({ id: String(e._id), type: e.type, quantityChange: e.quantityChange, reason: e.reason || "", actorName: e.actorName || "—", createdAt: e.createdAt })));
});

router.patch("/:id/archive", requireAuth, requireRole("admin"), async (req, res) => {
  if (!ObjectId.isValid(req.params.id) || typeof req.body.active !== "boolean")
    return res.status(400).json({ error: "Invalid archive request." });
  const db = req.app.locals.db;
  const id = new ObjectId(req.params.id);
  const product = await db.collection("inventory").findOneAndUpdate({ _id: id }, { $set: { active: req.body.active, updatedAt: new Date() } }, { returnDocument: "before" });
  if (!product) return res.status(404).json({ error: "Product not found." });
  if (product.active !== req.body.active) {
    await db.collection("inventoryEvents").insertOne({ inventoryId: id, type: req.body.active ? "restored" : "archived", quantityChange: 0, actorName: req.user.name || "Admin", createdAt: new Date() });
    await audit(req, req.body.active ? "inventory.restored" : "inventory.archived", { product: product.name });
  }
  res.json({ message: req.body.active ? "Product restored." : "Product archived." });
});

module.exports = router;
