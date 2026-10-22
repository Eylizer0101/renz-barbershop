const express = require("express");
const { ObjectId } = require("mongodb");
const crypto = require("crypto");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText, positiveNumber } = require("../utils/validation");
const { audit } = require("../utils/security");

const router = express.Router();
const imagePath = /^\/uploads\/inventory\/[a-f0-9-]+\.(?:jpg|png|webp)$/;
const imageValue = value => typeof value === "string" && imagePath.test(value) ? value : "";

// Keep inventory records and their movement history in the same transaction.
async function inventoryTransaction(req, work) {
  const session = req.app.locals.mongoClient?.startSession();
  if (!session) { const error = new Error("Database transaction is unavailable."); error.status = 503; throw error; }
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally { await session.endSession(); }
}
function inventoryError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function transactionFailure(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code === 112 || error.hasErrorLabel?.("TransientTransactionError"))
    return res.status(409).json({ error: "Inventory changed while processing. Refresh and try again." });
  throw error;
}


// Images are stored as binary in MongoDB, not on Render's ephemeral filesystem.
router.post("/images", requireAuth, requireRole("admin"), express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "2mb" }), async (req, res) => {
  const data = req.body;
  const mime = req.get("content-type")?.split(";")[0].trim().toLowerCase();
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  if (!Buffer.isBuffer(data) || !data.length || data.length > 2 * 1024 * 1024 || !extensions[mime])
    return res.status(400).json({ error: "Choose a JPG, PNG, or WebP image up to 2 MB." });
  const jpeg = mime === "image/jpeg" && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = mime === "image/png" && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = mime === "image/webp" && data.toString("ascii",0,4) === "RIFF" && data.toString("ascii",8,12) === "WEBP";
  if (!(jpeg || png || webp)) return res.status(400).json({ error: "Invalid product image format." });
  const filename = `${crypto.randomUUID()}.${extensions[mime]}`;
  await req.app.locals.db.collection("inventoryPhotos").insertOne({ _id: filename, data, contentType: mime, createdAt: new Date() });
  res.status(201).json({ imageUrl: `/uploads/inventory/${filename}` });
});

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
    imageUrl: imageValue(i.imageUrl),
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
  const imageUrl = imageValue(req.body.imageUrl);
  if (!/^(pcs|g|ml|bottles|boxes|packs|jars|cans)$/.test(unit)) return res.status(400).json({error:'Choose a valid stock unit.'});

  if (name.length < 2) return res.status(400).json({ error: "Product name is required." });
  if (!positiveNumber(quantity) || !Number.isInteger(quantity)) return res.status(400).json({ error: "Quantity must be a whole number >= 0." });
  if (!positiveNumber(minimumStock) || !Number.isInteger(minimumStock)) return res.status(400).json({ error: "Minimum stock must be a whole number >= 0." });
  if (!positiveNumber(price)) return res.status(400).json({ error: "Price must be >= 0." });
  if (!Number.isFinite(unitCost) || unitCost < 0) return res.status(400).json({ error: "Unit cost must be >= 0." });

  const doc = {
    name, category, quantity, minimumStock, price, unit, unitCost, supplier, imageUrl, active: true,
    createdAt: new Date(), updatedAt: new Date()
  };
  let result;
  try {
    result = await inventoryTransaction(req, async session => {
      const inserted = await db.collection("inventory").insertOne(doc, { session });
      await db.collection("inventoryEvents").insertOne({
        inventoryId: inserted.insertedId, type: "created", quantityChange: quantity, createdAt: new Date()
      }, { session });
      return inserted;
    });
  } catch (error) { return transactionFailure(res, error); }

  try { await audit(req, "inventory.created", { product: name, quantity, price }); } catch (error) { console.error("Inventory audit failed:", error.message); }
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

  try {
    await inventoryTransaction(req, async session => {
      // Reject stale form submissions instead of overwriting a more recent stock movement.
      const result = await db.collection("inventory").updateOne(
        { _id: id, quantity: current.quantity, updatedAt: current.updatedAt },
        { $set: { name, category, quantity, minimumStock, price, unit, unitCost, supplier, ...(req.body.imageUrl !== undefined ? { imageUrl: imageValue(req.body.imageUrl) } : {}), updatedAt: new Date() } },
        { session }
      );
      if (!result.matchedCount) throw inventoryError("Inventory changed since this page was opened. Refresh before saving.");
      await db.collection("inventoryEvents").insertOne({
        inventoryId: id, type: "updated", quantityChange: quantity - current.quantity, createdAt: new Date()
      }, { session });
    });
  } catch (error) { return transactionFailure(res, error); }

  try { await audit(req, "inventory.updated", { product: name, quantityBefore: current.quantity, quantityAfter: quantity, price }); } catch (error) { console.error("Inventory audit failed:", error.message); }
  res.json({ message: "Inventory updated." });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid product ID." });
  const id = new ObjectId(req.params.id);
  let current;
  try {
    current = await inventoryTransaction(req, async session => {
      const deleted = await db.collection("inventory").findOneAndDelete({ _id: id }, { session });
      if (!deleted) throw inventoryError("Product not found.", 404);
      await db.collection("inventoryEvents").insertOne({
        inventoryId: id, type: "deleted", quantityChange: -deleted.quantity, createdAt: new Date()
      }, { session });
      return deleted;
    });
  } catch (error) { return transactionFailure(res, error); }

  try { await audit(req, "inventory.deleted", { product: current.name, quantity: current.quantity }); } catch (error) { console.error("Inventory audit failed:", error.message); }
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
  let previous;
  try {
    previous = await inventoryTransaction(req, async session => {
      const old = await db.collection("inventory").findOneAndUpdate(filter,
        { $inc: { quantity: delta }, $set: { updatedAt: new Date() } },
        { returnDocument: "before", session });
      if (!old) throw inventoryError("Product is archived, missing, or has insufficient stock.");
      await db.collection("inventoryEvents").insertOne({
        inventoryId: id, type: direction === "in" ? "stock-in" : "stock-out",
        quantityChange: delta, reason, actorName: req.user.name || "Admin", createdAt: new Date()
      }, { session });
      return old;
    });
  } catch (error) { return transactionFailure(res, error); }
  try { await audit(req, direction === "in" ? "inventory.stock-in" : "inventory.stock-out", { product: previous.name, quantityBefore: previous.quantity, quantityAfter: previous.quantity + delta, reason }); } catch (error) { console.error("Inventory audit failed:", error.message); }
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
  let product;
  try {
    product = await inventoryTransaction(req, async session => {
      const old = await db.collection("inventory").findOneAndUpdate(
        { _id: id }, { $set: { active: req.body.active, updatedAt: new Date() } },
        { returnDocument: "before", session });
      if (!old) throw inventoryError("Product not found.", 404);
      if (old.active !== req.body.active) {
        await db.collection("inventoryEvents").insertOne({ inventoryId: id,
          type: req.body.active ? "restored" : "archived", quantityChange: 0,
          actorName: req.user.name || "Admin", createdAt: new Date() }, { session });
      }
      return old;
    });
  } catch (error) { return transactionFailure(res, error); }
  if (product.active !== req.body.active) {
    try { await audit(req, req.body.active ? "inventory.restored" : "inventory.archived", { product: product.name }); } catch (error) { console.error("Inventory audit failed:", error.message); }
  }
  res.json({ message: req.body.active ? "Product restored." : "Product archived." });
});

module.exports = router;
