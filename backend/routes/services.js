const express = require("express");
const { GridFSBucket, ObjectId } = require("mongodb");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText, validName, toObjectId } = require("../utils/validation");
const { audit } = require("../utils/security");

const router = express.Router();

// Store admin-uploaded haircut pictures in MongoDB so they remain available after deployment.
const imageTypes = {
  "image/jpeg": bytes => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": bytes => bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  "image/webp": bytes => bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
};

router.post("/images", requireAuth, requireRole("admin"), express.raw({
  type: ["image/jpeg", "image/png", "image/webp"], limit: "3mb"
}), async (req, res) => {
  const type = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || !imageTypes[type]?.(bytes)) {
    return res.status(400).json({ error: "Choose a valid JPG, PNG, or WebP image (maximum 3 MB)." });
  }
  const bucket = new GridFSBucket(req.app.locals.db, { bucketName: "serviceImages" });
  const upload = bucket.openUploadStream("haircut-image", { metadata: { contentType: type } });
  try {
    await new Promise((resolve, reject) => {
      upload.on("finish", resolve);
      upload.on("error", reject);
      upload.end(bytes);
    });
    res.status(201).json({ imageUrl: `/api/services/images/${upload.id}` });
  } catch (error) {
    console.error("Service image upload failed:", error);
    res.status(500).json({ error: "Unable to upload the image. Please try again." });
  }
});

router.get("/images/:id", async (req, res) => {
  if (!/^[0-9a-f]{24}$/i.test(req.params.id)) return res.sendStatus(404);
  const bucket = new GridFSBucket(req.app.locals.db, { bucketName: "serviceImages" });
  const id = new ObjectId(req.params.id);
  const files = await bucket.find({ _id: id }).limit(1).toArray();
  if (!files.length) return res.sendStatus(404);
  res.set("Content-Type", files[0].metadata?.contentType || "application/octet-stream");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "public, max-age=3600");
  const stream = bucket.openDownloadStream(id);
  stream.on("error", error => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy(error);
  });
  stream.pipe(res);
});

function serviceView(s) {
  return {
    id: String(s._id),
    name: s.name,
    price: s.price,
    durationMinutes: s.durationMinutes,
    imageUrl: s.imageUrl || "",
    active: s.active !== false,
    createdAt: s.createdAt || null,
    archivedAt: s.archivedAt || null
  };
}

function readService(body) {
  const name = cleanText(body.name, 60);
  const price = Number(body.price);
  const durationMinutes = Number(body.durationMinutes);

  if (!validName(name)) return { error: "Service name must be 2 to 60 characters." };
  if (!Number.isFinite(price) || price < 0 || price > 100000) return { error: "Enter a valid price." };
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
    return { error: "Duration must be a whole number of minutes from 5 to 480." };
  }

  const imageUrl = cleanText(body.imageUrl, 500);
  if (imageUrl && !(/^https:\/\//i.test(imageUrl) || /^\/images\/[a-zA-Z0-9._/-]+$/.test(imageUrl) || /^\/api\/services\/images\/[a-fA-F0-9]{24}$/.test(imageUrl))) return {error:"Enter an HTTPS photo URL or a valid uploaded image path."};
  return { value: { name, price: Math.round(price * 100) / 100, durationMinutes, imageUrl } };
}

// Services customers can choose from.
router.get("/", async (req, res) => {
  const services = await req.app.locals.db.collection("services")
    .find({ active: { $ne: false } })
    .sort({ name: 1 })
    .toArray();

  res.json(services.map(serviceView));
});

// ADMIN: every service, including hidden ones.
router.get("/all", requireAuth, requireRole("admin"), async (req, res) => {
  const services = await req.app.locals.db.collection("services").find().sort({ name: 1 }).toArray();
  res.json(services.map(serviceView));
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { value, error } = readService(req.body);
  if (error) return res.status(400).json({ error });

  const service = { ...value, active: true, createdAt: new Date(), updatedAt: new Date() };

  try {
    const result = await req.app.locals.db.collection("services").insertOne(service);
    await audit(req, "service.created", { service: service.name, price: service.price });
    res.status(201).json(serviceView({ _id: result.insertedId, ...service }));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "A service with this name already exists. If it is hidden, show it again instead." });
    }
    throw err;
  }
});

router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid service ID." });

  const { value, error } = readService(req.body);
  if (error) return res.status(400).json({ error });

  if (typeof req.body.active === "boolean") {
    value.active = req.body.active;
    value.archivedAt = req.body.active ? null : new Date();
  }

  try {
    const result = await req.app.locals.db.collection("services").findOneAndUpdate(
      { _id: id },
      { $set: { ...value, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) return res.status(404).json({ error: "Service not found." });
    await audit(req, req.body.active === true ? "service.restored" : "service.updated", { service: result.name, price: result.price, durationMinutes: result.durationMinutes, active: result.active !== false });
    res.json(serviceView(result));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "A service with this name already exists." });
    throw err;
  }
});

// Hiding keeps past visits and payments that mention the service intact.
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid service ID." });

  const result = await req.app.locals.db.collection("services").updateOne(
    { _id: id },
    { $set: { active: false, archivedAt: new Date(), updatedAt: new Date() } }
  );

  if (!result.matchedCount) return res.status(404).json({ error: "Service not found." });
  await audit(req, "service.hidden", { serviceId: String(id) });
  res.json({ message: "Service hidden from customers." });
});

module.exports = router;
