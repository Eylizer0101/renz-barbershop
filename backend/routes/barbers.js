const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const express = require("express");
const { requireAuth, optionalAuth, requireRole } = require("../middleware/auth");
const { cleanText, validName, toObjectId } = require("../utils/validation");
const { todayKey } = require("../utils/dates");
const { audit } = require("../utils/security");

const router = express.Router();

const MAX_ACTIVE_BARBERS = 3;
// Serialize capacity-changing actions within this server process so simultaneous
// requests cannot both pass a separate count check.
let capacityOperation = Promise.resolve();
function withCapacityLock(action) {
  const operation = capacityOperation.then(action, action);
  capacityOperation = operation.catch(() => {});
  return operation;
}
async function atCapacity(db) {
  return (await db.collection("barbers").countDocuments({ active: true })) >= MAX_ACTIVE_BARBERS;
}


// Store validated uploaded photos outside the public frontend source tree.
const PHOTO_DIR = path.join(__dirname, "..", "uploads", "barbers");
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
function parsePhoto(data) {
  if (typeof data !== "string") throw new Error("Invalid photo upload.");
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw new Error("Upload a JPEG, PNG, or WebP image.");
  const binary = Buffer.from(match[2], "base64");
  if (!binary.length || binary.length > PHOTO_MAX_BYTES) throw new Error("Photo must be 2 MB or smaller.");
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const valid = ext === "jpg" ? binary.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : ext === "png" ? binary.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : binary.toString("ascii", 0, 4) === "RIFF" && binary.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new Error("The selected image file is not valid.");
  return { binary, ext };
}
// Persist new photos in MongoDB rather than Render's ephemeral filesystem.
// Keep the existing public URL format for all frontend barber cards.
async function savePhoto(db, data) {
  const { binary, ext } = parsePhoto(data);
  const filename = `${randomUUID()}.${ext}`;
  const contentType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  await db.collection("barberPhotos").insertOne({
    _id: filename,
    data: binary,
    contentType,
    createdAt: new Date()
  });
  return `/uploads/barbers/${filename}`;
}
async function deleteOwnedPhoto(db, url) {
  const name = /^\/uploads\/barbers\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/.exec(String(url || ""))?.[1];
  if (!name) return;
  await db.collection("barberPhotos").deleteOne({ _id: name });
  // Support cleanup of photos uploaded before the MongoDB-backed change.
  await fs.unlink(path.join(PHOTO_DIR, name)).catch(() => {});
}

// status: "available" (on duty and free), "busy" (serving someone) or "unavailable" (off duty).
async function barberViews(db, filter) {
  const barbers = await db.collection("barbers").find(filter).sort({ name: 1 }).toArray();


  const serving = await db.collection("queueTickets")
    .find({ queueDate: todayKey(), status: "serving" }, { projection: { barberId: 1, queueNumber: 1 } })
    .toArray();
  const servingMap = new Map(serving.map(t => [String(t.barberId), t.queueNumber]));

  return barbers.map(barber => {
    const id = String(barber._id);
    const servingNumber = servingMap.get(id) ?? null;

    return {
      id,
      name: barber.name,
      active: barber.active !== false,
      available: barber.available === true,
      status: barber.active === false || !barber.available ? "unavailable" : servingNumber ? "busy" : "available",
      servingNumber,
      specialty: barber.specialty || "General Barber",
      bio: barber.bio || "",
      photoUrl: barber.photoUrl || "",
      experienceYears: barber.experienceYears || 0
    };
  });
}

function readProfile(body) {
  const name = cleanText(body.name, 60);
  const experienceYears = Number(body.experienceYears ?? 0);

  if (!validName(name)) return { error: "Barber name must be 2 to 60 characters." };
  if (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 60) {
    return { error: "Years of experience must be a whole number from 0 to 60." };
  }

  return {
    value: {
      name,
      specialty: cleanText(body.specialty, 80),
      bio: cleanText(body.bio, 500),
      photoUrl: cleanText(body.photoUrl, 500),
      experienceYears
    }
  };
}

// Active barbers for customers and the front desk.
router.get("/", async (req, res) => {
  res.json(await barberViews(req.app.locals.db, { active: true }));
});

// ADMIN: all barbers, including removed ones that can be restored.
router.get("/all", requireAuth, requireRole("admin"), async (req, res) => {
  res.json(await barberViews(req.app.locals.db, {}));
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { value, error } = readProfile(req.body);
  if (error) return res.status(400).json({ error });

  return withCapacityLock(async () => {
  if (await atCapacity(req.app.locals.db)) {
    return res.status(409).json({ error: "Maximum of 3 active barbers reached. Archive a barber first." });
  }
  let newPhoto = "";
  try {
    if (req.body.photoData !== undefined) {
      try { newPhoto = await savePhoto(req.app.locals.db, req.body.photoData); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      value.photoUrl = newPhoto;
    }
    const result = await req.app.locals.db.collection("barbers").insertOne({
      ...value,
      active: true,
      available: true,
      createdAt: new Date()
    });

    res.status(201).json({ id: String(result.insertedId), ...value });
  } catch (err) {
    await deleteOwnedPhoto(req.app.locals.db, newPhoto);
    if (err.code === 11000) return res.status(409).json({ error: "A barber with this name already exists (it may be removed — restore it instead)." });
    throw err;
  }
  });
});

// ADMIN: edit a profile, or restore a removed barber with { active: true }.
router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid barber ID." });

  const { value, error } = readProfile(req.body);
  if (error) return res.status(400).json({ error });

  if (req.body.active === true) value.active = true;

  return withCapacityLock(async () => {
  let newPhoto = "";
  try {
    const collection = req.app.locals.db.collection("barbers");
    const old = await collection.findOne({ _id: id });
    if (!old) return res.status(404).json({ error: "Barber not found." });
    if (req.body.active === true && old.active === false && await atCapacity(req.app.locals.db)) {
      return res.status(409).json({ error: "Maximum of 3 active barbers reached. Archive a barber first." });
    }
    if (req.body.photoData !== undefined) {
      try { newPhoto = await savePhoto(req.app.locals.db, req.body.photoData); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      value.photoUrl = newPhoto;
    } else if (req.body.photoUrl === undefined) {
      value.photoUrl = old.photoUrl || "";
    }
    const result = await collection.updateOne({ _id: id }, { $set: value });
    if (!result.matchedCount) { await deleteOwnedPhoto(req.app.locals.db, newPhoto); return res.status(404).json({ error: "Barber not found." }); }
    if (newPhoto) await deleteOwnedPhoto(req.app.locals.db, old.photoUrl);
    if (value.active) await audit(req, "barber.restored", { barber: value.name });
    res.json({ message: "Barber updated." });
  } catch (err) {
    await deleteOwnedPhoto(req.app.locals.db, newPhoto);
    if (err.code === 11000) return res.status(409).json({ error: "A barber with this name already exists." });
    throw err;
  }
  });
});

// ADMIN: remove a barber. Their past visits are kept.
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const db = req.app.locals.db;
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid barber ID." });

  const upcoming=await db.collection('appointments').findOne({barberId:id,status:{$in:['pending','confirmed']},startsAt:{$gte:new Date()}});
  if(upcoming)return res.status(409).json({error:'This barber has upcoming appointments. Cancel those appointments first.'});
  const serving = await db.collection("queueTickets").findOne({ barberId: id, status: "serving", queueDate: todayKey() });
  if (serving) return res.status(409).json({ error: `This barber is serving #${serving.queueNumber}. Complete that visit first.` });

  const barber = await db.collection("barbers").findOneAndUpdate({ _id: id }, { $set: { active: false, available: false } });
  if (!barber) return res.status(404).json({ error: "Barber not found." });

  // Customers waiting for this barber can now be called by anyone.
  const released = await db.collection("queueTickets").updateMany(
    { queueDate: todayKey(), status: { $in: ["waiting", "assigned"] }, preferredBarberId: id },
    { $set: { preferredBarberId: null, preferredBarberName: null } }
  );

  await audit(req, "barber.removed", { barber: barber.name, customersReleased: released.modifiedCount });
  res.json({ message: `Barber removed.${released.modifiedCount ? ` ${released.modifiedCount} waiting customer(s) can now be served by any barber.` : ""}` });
});

// ADMIN OR CASHIER: mark a barber on duty (available) or off duty.
router.patch("/:id/availability", requireAuth, requireRole("admin", "cashier"), async (req, res) => {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid barber ID." });

  if (typeof req.body.available !== "boolean") {
    return res.status(400).json({ error: "Availability must be true or false." });
  }

  // Do not allow an active service to be marked off duty through a direct API request.
  if (req.body.available === false) {
    const serving = await req.app.locals.db.collection("queueTickets").findOne({
      barberId: id,
      queueDate: todayKey(),
      status: "serving"
    });
    if (serving) {
      return res.status(409).json({
        error: `This barber is serving #${serving.queueNumber}. Complete that visit first.`
      });
    }
  }

  const result = await req.app.locals.db.collection("barbers").updateOne(
    { _id: id, active: true },
    { $set: { available: req.body.available } }
  );

  if (!result.matchedCount) return res.status(404).json({ error: "Barber not found." });
  res.json({ message: "Availability updated." });
});

module.exports = router;
