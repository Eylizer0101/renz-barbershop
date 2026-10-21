const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cleanText, validEmail, validName, strongPassword, basicPassword, toObjectId } = require("../utils/validation");
const { cookieOptions, HOME_PAGES, publicUser, startSession, rememberDevice, isTrustedDevice } = require("../utils/session");
const { DUMMY_HASH, audit } = require("../utils/security");
const { todayKey } = require("../utils/dates");
const { send2FA, sendCustomerVerification, sendPasswordReset } = require("../utils/mailer");

const router = express.Router();

function limiter(limit, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message }
  });
}

const loginLimiter = limiter(20, "Too many login attempts from this device. Try again later.");
const codeLimiter = limiter(10, "Too many verification attempts. Try again later.");
const registerLimiter = limiter(10, "Too many sign-ups from this device. Try again later.");

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODE_RESENDS = 3;
const MAX_FAILED_LOGINS = 3;
const LOCK_MS = 180 * 1000;

const expired = { error: "Your sign-in has expired. Please log in again." };

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function newCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

// Track consecutive wrong passwords/codes in MongoDB, shared across browsers and reloads.
// Atomic updates prevent simultaneous failures from bypassing the three-attempt limit.
async function recordFailure(db, user) {
  const users = db.collection("users");
  const now = new Date();
  const updated = await users.findOneAndUpdate(
    { _id: user._id, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }] },
    { $inc: { failedLogins: 1 } },
    { returnDocument: "after" }
  );
  if (!updated) {
    const current = await users.findOne({ _id: user._id });
    return { lockedUntil: current?.lockedUntil || null, attempts: current?.failedLogins || 0 };
  }
  if (updated.failedLogins >= MAX_FAILED_LOGINS) {
    const lockedUntil = new Date(Date.now() + LOCK_MS);
    const locked = await users.findOneAndUpdate(
      { _id: user._id, failedLogins: { $gte: MAX_FAILED_LOGINS },
        $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }] },
      { $set: { failedLogins: 0, lockedUntil } },
      { returnDocument: "after" }
    );
    if (locked) return { lockedUntil: locked.lockedUntil, attempts: MAX_FAILED_LOGINS };
    const current = await users.findOne({ _id: user._id });
    return { lockedUntil: current?.lockedUntil || null, attempts: current?.failedLogins || 0 };
  }
  return { lockedUntil: null, attempts: updated.failedLogins };
}

async function clearFailures(db, user) {
  if (user.failedLogins || user.lockedUntil) {
    await db.collection("users").updateOne({ _id: user._id }, { $unset: { failedLogins: "", lockedUntil: "" } });
  }
}

function lockedMessage(user) {
  const lockedUntil = new Date(user.lockedUntil).getTime();
  return { error: "Too many failed attempts. Your account is temporarily locked.",
    code: "ACCOUNT_LOCKED", lockedUntil: new Date(lockedUntil).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000)) };
}

// Used only to restore the locked modal. Never expose account existence or attempt counts here.
router.post("/login-lock-status", loginLimiter, async (req, res) => {
  const email = cleanText(req.body?.email, 254).toLowerCase();
  if (!validEmail(email)) return res.json({ locked: false });
  const user = await req.app.locals.db.collection("users").findOne(
    { email, active: { $ne: false } }, { projection: { lockedUntil: 1 } }
  );
  if (user?.lockedUntil > new Date()) return res.json({ locked: true, ...lockedMessage(user) });
  return res.json({ locked: false });
});

async function finishLogin(req, res, user, how) {
  await clearFailures(req.app.locals.db, user);
  startSession(res, user);
  req.user = user;
  await audit(req, "login", { how });
  res.json({ user: publicUser(user), redirectUrl: HOME_PAGES[user.role] || "/login.html" });
}

// Admin, cashier and customer sign in using their password and go directly to their own dashboard.
// Keep password checks, account lockout, session handling and role-based API protection.
router.post("/login", loginLimiter, async (req, res) => {
  const db = req.app.locals.db;
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = String(req.body.password ?? "");

  if (!validEmail(email) || !password) {
    return res.status(400).json({ error: "Enter your email and password." });
  }

  const user = await db.collection("users").findOne({ email, active: { $ne: false } });

  if (user?.lockedUntil > new Date()) {
    return res.status(429).json(lockedMessage(user));
  }

  const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !passwordOk) {
    const failure = user ? await recordFailure(db, user) : null;
    await audit(req, "login.failed", { email, locked: Boolean(failure?.lockedUntil) });
    if (failure?.lockedUntil > new Date()) return res.status(429).json(lockedMessage(failure));
    return res.status(401).json({ error: "Invalid email or password.",
      ...(user ? { attemptsRemaining: Math.max(0, MAX_FAILED_LOGINS - (failure?.attempts || 0)),
        attempt: failure?.attempts || 1, maxAttempts: MAX_FAILED_LOGINS } : {}) });
  }

  // Clear any pending code from a previous admin login attempt.
  res.clearCookie("pending2fa", cookieOptions);
  return finishLogin(req, res, user, "password");
});

router.post("/verify-2fa", codeLimiter, async (req, res) => {
  const db = req.app.locals.db;
  const challengeId = toObjectId(req.signedCookies.pending2fa);
  const code = String(req.body.code ?? "").trim();

  if (!challengeId) return res.status(401).json(expired);

  // Count the attempt atomically so parallel guesses can't exceed the limit.
  const challenge = await db.collection("loginChallenges").findOneAndUpdate(
    { _id: challengeId, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_CODE_ATTEMPTS } },
    { $inc: { attempts: 1 } }
  );

  if (!challenge) {
    await db.collection("loginChallenges").deleteOne({ _id: challengeId });
    res.clearCookie("pending2fa", cookieOptions);
    return res.status(401).json(expired);
  }

  const user = await db.collection("users").findOne({ _id: challenge.userId, active: { $ne: false } });
  if (!user) return res.status(401).json(expired);
  if (user.lockedUntil > new Date()) return res.status(429).json(lockedMessage(user));

  if (!/^\d{6}$/.test(code) || hashCode(code) !== challenge.codeHash) {
    const failure = await recordFailure(db, user);
    await audit(req, "login.code-failed", { email: user.email, locked: Boolean(failure.lockedUntil) });
    if (failure.lockedUntil > new Date()) return res.status(429).json(lockedMessage(failure));
    return res.status(401).json({ error: "Incorrect verification code." });
  }

  await db.collection("loginChallenges").deleteOne({ _id: challengeId });
  res.clearCookie("pending2fa", cookieOptions);

  if (req.body.remember === true) await rememberDevice(req, res, user);
  await finishLogin(req, res, user, req.body.remember === true ? "password + code (device remembered)" : "password + code");
});

router.post("/resend-code", codeLimiter, async (req, res) => {
  const db = req.app.locals.db;
  const challengeId = toObjectId(req.signedCookies.pending2fa);
  if (!challengeId) return res.status(401).json(expired);

  // A new code doesn't reset the attempt count, and only 3 new codes are allowed per sign-in.
  const challenge = await db.collection("loginChallenges").findOneAndUpdate(
    { _id: challengeId, expiresAt: { $gt: new Date() }, resends: { $lt: MAX_CODE_RESENDS } },
    { $inc: { resends: 1 } }
  );

  if (!challenge) return res.status(429).json({ error: "No more codes can be sent for this sign-in. Please log in again." });

  const user = await db.collection("users").findOne({ _id: challenge.userId, active: { $ne: false } });
  if (!user) return res.status(401).json(expired);

  const code = newCode();
  await db.collection("loginChallenges").updateOne(
    { _id: challengeId },
    { $set: { codeHash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } }
  );

  try {
    await send2FA(user.email, code);
  } catch (error) {
    console.error("Failed to resend 2FA email:", error);
    return res.status(502).json({ error: "Could not send the verification email. Check the SMTP settings." });
  }

  res.cookie("pending2fa", String(challengeId), { ...cookieOptions, signed: true, maxAge: CODE_TTL_MS });
  res.json({ message: "A new code has been sent." });
});

// Customer sign-up requires email verification. Pending registrations are separate from users.
const REGISTRATION_TTL_MS = 5 * 60 * 1000;
const REGISTRATION_COOLDOWN_MS = 120 * 1000;
const REGISTRATION_MAX_ATTEMPTS = 5;
const REGISTRATION_MAX_RESENDS = 3;
const registerCodeLimiter = limiter(12, "Too many registration verification requests. Try again later.");
function registrationCodeHash(email, code) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`registration:${email}:${code}`).digest("hex");
}
function registrationCookie(res, email) {
  // Signed, HTTP-only cookie; no OTP or password is stored in the browser.
  res.cookie("pendingRegistration", email, { ...cookieOptions, signed: true, maxAge: 24 * 60 * 60 * 1000 });
}
function pendingEmail(req) {
  const email = req.signedCookies?.pendingRegistration;
  return typeof email === "string" && validEmail(email) ? email : null;
}
router.post("/register", registerLimiter, async (req, res) => {
  const db = req.app.locals.db;
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const phone = cleanText(req.body.phone, 20);
  const password = String(req.body.password ?? "");
  if (!validName(name)) return res.status(400).json({ error: "Enter your name (2 to 60 characters)." });
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!basicPassword(password)) return res.status(400).json({ error: "Password must be at least 8 characters with letters and numbers." });
  if (await db.collection("users").findOne({ email })) return res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
  const pending = db.collection("pendingCustomerRegistrations");
  const now = new Date();
  const current = await pending.findOne({ _id: email });
  if (current?.resendAvailableAt > now && current.expiresAt > now) {
    return res.status(429).json({ error: "Please wait 120 seconds before requesting another code." });
  }
  const code = newCode();
  const doc = {
    name, email, phone, passwordHash: await bcrypt.hash(password, 12),
    codeHash: registrationCodeHash(email, code),
    expiresAt: new Date(Date.now() + REGISTRATION_TTL_MS),
    resendAvailableAt: new Date(Date.now() + REGISTRATION_COOLDOWN_MS),
    attempts: 0, resends: 0, createdAt: now
  };
  // Unique _id keeps only one pending application per email.
  await pending.replaceOne({ _id: email }, { _id: email, ...doc }, { upsert: true });
  try {
    await sendCustomerVerification(email, code);
  } catch (error) {
    console.error("[Customer OTP] Email send failed:", error.code || "MAIL_ERROR", error.responseCode || error.status || "Check Brevo configuration and backend connection");
    await pending.deleteOne({ _id: email, codeHash: doc.codeHash });
    return res.status(502).json({ error: "Unable to send the verification email. Please try again later or check the mail configuration." });
  }
  registrationCookie(res, email);
  res.status(202).json({ message: "Verification email sent.", redirectUrl: "/verify.html?flow=registration", resendAfterSeconds: 120 });
});

router.get("/registration-status", registerCodeLimiter, async (req, res) => {
  const email = pendingEmail(req);
  if (!email) return res.status(401).json({ error: "Start by registering an account." });
  const pending = await req.app.locals.db.collection("pendingCustomerRegistrations").findOne({ _id: email });
  if (!pending) return res.status(404).json({ error: "No pending registration. Please register again." });
  res.json({ email, resendAfterSeconds: Math.max(0, Math.ceil((pending.resendAvailableAt - Date.now()) / 1000)), expired: pending.expiresAt <= new Date() });
});

router.post("/verify-registration", registerCodeLimiter, async (req, res) => {
  const email = pendingEmail(req);
  if (!email) return res.status(401).json({ error: "Registration expired. Please register again." });
  const code = String(req.body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter a valid 6-digit code." });
  const pending = req.app.locals.db.collection("pendingCustomerRegistrations");
  const entry = await pending.findOneAndUpdate(
    { _id: email, expiresAt: { $gt: new Date() }, attempts: { $lt: REGISTRATION_MAX_ATTEMPTS }, claimedAt: { $exists: false } },
    { $inc: { attempts: 1 } }, { returnDocument: "after" }
  );
  if (!entry) return res.status(410).json({ error: "Code expired or too many attempts. Please request a new code." });
  const suppliedHash = registrationCodeHash(email, code);
  if (!crypto.timingSafeEqual(Buffer.from(entry.codeHash, "hex"), Buffer.from(suppliedHash, "hex"))) {
    return res.status(400).json({ error: "Incorrect verification code." });
  }
  // Claim once so concurrent verification requests cannot create multiple accounts.
  const claimed = await pending.findOneAndUpdate(
    { _id: email, codeHash: entry.codeHash, claimedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { claimedAt: new Date() } }, { returnDocument: "after" }
  );
  if (!claimed) return res.status(409).json({ error: "Code already used. Please sign in or try again." });
  const db = req.app.locals.db;
  const user = {
    name: claimed.name, email, phone: claimed.phone, passwordHash: claimed.passwordHash,
    role: "customer", active: true, emailVerified: true, emailVerifiedAt: new Date(),
    sessionVersion: 0, createdAt: new Date(), updatedAt: new Date()
  };
  try {
    const result = await db.collection("users").insertOne(user);
    user._id = result.insertedId;
  } catch (error) {
    await pending.deleteOne({ _id: email });
    if (error.code === 11000) return res.status(409).json({ error: "This email is already registered. Please sign in." });
    throw error;
  }
  const guestTicket = toObjectId(req.signedCookies.queueTicket);
  if (guestTicket) {
    await db.collection("queueTickets").updateOne(
      { _id: guestTicket, queueDate: todayKey(), customerId: null, status: { $ne: "cancelled" } },
      { $set: { customerId: user._id, customerName: user.name } }
    );
  }
  await pending.deleteOne({ _id: email });
  res.clearCookie("pendingRegistration", cookieOptions);
  res.clearCookie("queueTicket", cookieOptions);
  startSession(res, user);
  await audit({ app: req.app, user, ip: req.ip }, "customer.registered", { account: user.name });
  res.json({ message: "Email verified. Your account is ready.", redirectUrl: HOME_PAGES.customer });
});

router.post("/resend-registration", registerCodeLimiter, async (req, res) => {
  const email = pendingEmail(req);
  if (!email) return res.status(401).json({ error: "Register again to request a code." });
  const pending = req.app.locals.db.collection("pendingCustomerRegistrations");
  const now = new Date();
  const code = newCode();
  const codeHash = registrationCodeHash(email, code);
  const result = await pending.findOneAndUpdate(
    { _id: email, claimedAt: { $exists: false }, resendAvailableAt: { $lte: now }, resends: { $lt: REGISTRATION_MAX_RESENDS } },
    { $set: { codeHash, expiresAt: new Date(Date.now() + REGISTRATION_TTL_MS), resendAvailableAt: new Date(Date.now() + REGISTRATION_COOLDOWN_MS), attempts: 0 }, $inc: { resends: 1 } },
    { returnDocument: "after" }
  );
  if (!result) return res.status(429).json({ error: "Please wait for the cooldown, or you have reached the resend limit. Register again later." });
  try { await sendCustomerVerification(email, code); }
  catch (error) {
    console.error("[Customer OTP] Resend failed:", error.code || "MAIL_ERROR", error.responseCode || error.status || "Check Brevo configuration and backend connection");
    await pending.updateOne({ _id: email, codeHash }, { $set: { resendAvailableAt: new Date(0) } });
    return res.status(502).json({ error: "Unable to resend verification email. Please try again later." });
  }
  res.json({ message: "A new verification code has been sent.", resendAfterSeconds: 120 });
});



// Staff registration is invitation-code gated, with separate Admin/Cashier codes.
// The invisible link is only navigation; the server ALWAYS verifies authorization.
const staffRegisterLimiter = limiter(5, "Too many staff registration requests. Try again later.");
const staffVerifyLimiter = limiter(10, "Too many staff verification attempts. Try again later.");
const STAFF_PENDING_TTL = 5 * 60 * 1000;
const STAFF_RESEND_COOLDOWN = 120 * 1000;
const STAFF_MAX_RESENDS = 3;
function staffSecret(role) {
  return role === "admin" ? process.env.ADMIN_REGISTRATION_CODE : process.env.CASHIER_REGISTRATION_CODE;
}
function staffSecretHash(secret) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`staff-secret:${secret}`).digest("hex");
}
function staffCodeMatches(supplied, configured) {
  if (typeof configured !== "string" || configured.length < 24 || typeof supplied !== "string") return false;
  const a = Buffer.from(staffSecretHash(supplied), "hex");
  const b = Buffer.from(staffSecretHash(configured), "hex");
  return crypto.timingSafeEqual(a, b);
}
function pendingStaffId(req) {
  const value = req.signedCookies?.pendingStaffRegistration;
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function staffOtpHash(id, code) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`staff-otp:${id}:${code}`).digest("hex");
}
function setStaffCookie(res, id) {
  res.cookie("pendingStaffRegistration", id, { ...cookieOptions, signed: true, maxAge: STAFF_PENDING_TTL });
}
router.post("/register-staff", staffRegisterLimiter, async (req, res) => {
  const db = req.app.locals.db;
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const role = req.body.role;
  const password = String(req.body.password ?? "");
  const code = req.body.registrationCode;
  if (!validName(name) || !validEmail(email) || !["admin", "cashier"].includes(role) || !strongPassword(password) || password.length > 128) {
    return res.status(400).json({ error: "Enter valid staff details and a strong password (10+ characters, uppercase, lowercase, number and symbol)." });
  }
  if (!staffSecret(role) || staffSecret(role).length < 24) {
    return res.status(503).json({ error: "Staff registration is not configured. Contact the system owner." });
  }
  if (!staffCodeMatches(code, staffSecret(role))) {
    return res.status(403).json({ error: "Invalid staff registration code." });
  }
  if (await db.collection("users").findOne({ email })) {
    return res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
  }
  const pending = db.collection("pendingStaffRegistrations");
  // Do not reset the cooldown by repeatedly requesting new verification emails.
  const recent = await pending.findOne({ email, expiresAt: { $gt: new Date() }, resendAvailableAt: { $gt: new Date() } });
  if (recent) return res.status(429).json({ error: "Please wait 120 seconds before requesting another verification code." });
  const id = crypto.randomBytes(32).toString("hex");
  const otp = newCode();
  const now = new Date();
  const doc = { _id: id, name, email, role, passwordHash: await bcrypt.hash(password, 12), authorizationHash: staffSecretHash(staffSecret(role)),
    otpHash: staffOtpHash(id, otp), attempts: 0, resends: 0, createdAt: now,
    expiresAt: new Date(Date.now() + STAFF_PENDING_TTL), resendAvailableAt: new Date(Date.now() + STAFF_RESEND_COOLDOWN) };
  await pending.deleteMany({ email });
  await pending.insertOne(doc);
  try { await sendCustomerVerification(email, otp); }
  catch (error) {
    await pending.deleteOne({ _id: id });
    console.error("[Staff Registration] Verification email failed:", error.code || error.message);
    return res.status(502).json({ error: "Could not send the verification email. Please check email configuration." });
  }
  setStaffCookie(res, id);
  return res.status(202).json({ message: "Verification code sent.", resendAfterSeconds: 120 });
});

router.get("/staff-registration-status", staffVerifyLimiter, async (req, res) => {
  const id = pendingStaffId(req);
  if (!id) return res.status(401).json({ error: "Start by completing staff registration." });
  const entry = await req.app.locals.db.collection("pendingStaffRegistrations").findOne({ _id: id, expiresAt: { $gt: new Date() } });
  if (!entry) return res.status(410).json({ error: "Staff registration has expired. Register again." });
  return res.json({ email: entry.email, resendAfterSeconds: Math.max(0, Math.ceil((entry.resendAvailableAt - Date.now()) / 1000)) });
});

router.post("/verify-staff-registration", staffVerifyLimiter, async (req, res) => {
  const id = pendingStaffId(req);
  const code = String(req.body.code ?? "").trim();
  if (!id || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit verification code." });
  const db = req.app.locals.db;
  const pending = db.collection("pendingStaffRegistrations");
  const entry = await pending.findOneAndUpdate({ _id: id, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 }, claimedAt: { $exists: false } }, { $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!entry) return res.status(410).json({ error: "Code expired or too many attempts. Start registration again." });
  if (!crypto.timingSafeEqual(Buffer.from(staffOtpHash(id, code), "hex"), Buffer.from(entry.otpHash, "hex"))) {
    return res.status(400).json({ error: "Incorrect verification code." });
  }
  // Rotating an authorization code invalidates existing pending registrations.
  const configured = staffSecret(entry.role);
  if (!configured || configured.length < 24 || !crypto.timingSafeEqual(Buffer.from(staffSecretHash(configured), "hex"), Buffer.from(entry.authorizationHash, "hex"))) {
    await pending.deleteOne({ _id: id });
    return res.status(403).json({ error: "Registration authorization expired. Contact the system owner." });
  }
  const claimed = await pending.findOneAndUpdate({ _id: id, otpHash: entry.otpHash, claimedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { claimedAt: new Date() } }, { returnDocument: "after" });
  if (!claimed) return res.status(409).json({ error: "This verification code was already used." });
  const user = { name: claimed.name, email: claimed.email, role: claimed.role, passwordHash: claimed.passwordHash, active: true,
    emailVerified: true, emailVerifiedAt: new Date(), sessionVersion: 0, mustChangePassword: false, createdAt: new Date(), updatedAt: new Date() };
  try { await db.collection("users").insertOne(user); }
  catch (error) {
    await pending.deleteOne({ _id: id });
    if (error.code === 11000) return res.status(409).json({ error: "An account with this email already exists." });
    throw error;
  }
  await pending.deleteOne({ _id: id });
  res.clearCookie("pendingStaffRegistration", cookieOptions);
  await audit(req, "staff.self-registered", { staff: user.name, email: user.email, role: user.role });
  return res.json({ message: "Staff account created. Sign in now.", redirectUrl: "/login.html#staff" });
});

router.post("/resend-staff-registration", staffVerifyLimiter, async (req, res) => {
  const id = pendingStaffId(req);
  if (!id) return res.status(401).json({ error: "Register again to request a code." });
  const pending = req.app.locals.db.collection("pendingStaffRegistrations");
  const now = new Date();
  const entry = await pending.findOne({ _id: id, expiresAt: { $gt: now }, resendAvailableAt: { $lte: now }, resends: { $lt: STAFF_MAX_RESENDS }, claimedAt: { $exists: false } });
  if (!entry) return res.status(429).json({ error: "Please wait for the cooldown or register again." });
  const code = newCode();
  const changed = await pending.updateOne({ _id: id, otpHash: entry.otpHash, resends: { $lt: STAFF_MAX_RESENDS } }, {
    $set: { otpHash: staffOtpHash(id, code), attempts: 0, expiresAt: new Date(Date.now() + STAFF_PENDING_TTL), resendAvailableAt: new Date(Date.now() + STAFF_RESEND_COOLDOWN) },
    $inc: { resends: 1 } });
  if (!changed.modifiedCount) return res.status(409).json({ error: "Please try again." });
  try { await sendCustomerVerification(entry.email, code); }
  catch (error) {
    console.error("[Staff Registration] Resend failed:", error.code || error.message);
    return res.status(502).json({ error: "Could not resend verification email." });
  }
  setStaffCookie(res, id);
  res.json({ message: "A new verification code has been sent.", resendAfterSeconds: 120 });
});

// Password recovery: hashed, one-use token, 15-minute expiration and no account enumeration.
const resetLimiter = limiter(5, 'Too many password reset requests. Please try again later.');
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_COOLDOWN_MS = 120 * 1000;
const RESET_SUCCESS = { message: 'If this email is registered, a password reset link will be sent.' };
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const db = req.app.locals.db;
  const user = await db.collection('users').findOne({ email, active: { $ne:false }, deletedAt: { $exists:false } });
  if (!user) return res.json(RESET_SUCCESS);
  const resetCollection = db.collection('passwordResetTokens');
  const recent = await resetCollection.findOne({ userId:user._id, createdAt:{ $gte:new Date(Date.now()-RESET_COOLDOWN_MS) } });
  if (recent) return res.json(RESET_SUCCESS);
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashCode(rawToken);
  const base = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  let resetUrl;
  try {
    const url = new URL('/forgot-password.html', base);
    if (!['https:', 'http:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Invalid origin');
    url.searchParams.set('token', rawToken);
    resetUrl = url.toString();
  } catch {
    console.error('[Password Reset] Configure APP_BASE_URL with your website URL.');
    return res.status(503).json({ error: 'Password recovery is temporarily unavailable. Please try again later.' });
  }
  // Only one live reset token per account. Older links become invalid.
  await resetCollection.deleteMany({ userId:user._id });
  await resetCollection.insertOne({ tokenHash, userId:user._id, createdAt:new Date(), expiresAt:new Date(Date.now()+RESET_TTL_MS) });
  try { await sendPasswordReset(email, resetUrl); }
  catch (error) {
    await resetCollection.deleteOne({ tokenHash });
    console.error('[Password Reset] Email delivery failed:', error.code || error.message);
    return res.status(503).json({ error:'Password reset email could not be sent. Please try again later.' });
  }
  return res.json(RESET_SUCCESS);
});

router.post('/reset-password', resetLimiter, async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error:'Invalid or expired reset link. Request another link.' });
  const db = req.app.locals.db;
  const tokenHash = hashCode(token);
  const candidate = await db.collection('passwordResetTokens').findOne({ tokenHash, expiresAt:{ $gt:new Date() } });
  if (!candidate) return res.status(400).json({ error:'Invalid or expired reset link. Request another link.' });
  const user = await db.collection('users').findOne({ _id:candidate.userId, active:{ $ne:false }, deletedAt:{ $exists:false } });
  if (!user) return res.status(400).json({ error:'Invalid or expired reset link. Request another link.' });
  const valid = user.role === 'customer' ? basicPassword(password) : strongPassword(password);
  if (!valid || password.length > 128) return res.status(400).json({ error: user.role === 'customer' ? 'Use at least 8 characters with letters and numbers.' : 'Use at least 10 characters with uppercase, lowercase, a number, and a symbol.' });
  if (await bcrypt.compare(password, user.passwordHash)) return res.status(400).json({ error:'Choose a password different from your current password.' });
  const claimed = await db.collection('passwordResetTokens').findOneAndDelete({ tokenHash, expiresAt:{ $gt:new Date() } });
  if (!claimed) return res.status(400).json({ error:'This reset link was already used or expired.' });
  await db.collection('users').updateOne({ _id:user._id }, { $set:{ passwordHash:await bcrypt.hash(password,12), mustChangePassword:false, updatedAt:new Date() }, $inc:{ sessionVersion:1 }, $unset:{ failedLogins:'', lockedUntil:'' } });
  // Finish cashier-assisted account setup only after the customer uses their email link.
  if (user.role === 'customer' && user.emailVerified === false && user.createdBy) {
    const ticketId = user.pendingWalkInTicketId;
    if (ticketId) {
      const linked = await db.collection('queueTickets').updateOne(
        { _id: ticketId, customerId: null, source: 'walk-in' },
        { $set: { customerId: user._id, customerName: user.name } }
      );
      if (linked.modifiedCount) await db.collection('payments').updateMany({ ticketId, customerId: null }, { $set: { customerId: user._id, customerName: user.name } });
    }
    await db.collection('users').updateOne({ _id: user._id }, { $set: { emailVerified: true, emailVerifiedAt: new Date() }, $unset: { pendingWalkInTicketId: '' } });
  }
  await db.collection('passwordResetTokens').deleteMany({userId:user._id});
  await db.collection('trustedDevices').deleteMany({userId:user._id});
  res.clearCookie('session',cookieOptions);
  await audit(req,'password.reset',{userId:String(user._id)});
  return res.json({message:'Password updated. You can sign in now.'});
});

router.post("/logout", (req, res) => {
  // Also forget the guest's queue ticket, so the next person on a shared device starts fresh.
  // A remembered admin device stays remembered.
  res.clearCookie("session", cookieOptions);
  res.clearCookie("queueTicket", cookieOptions);
  res.clearCookie("pending2fa", cookieOptions);
  res.clearCookie("pendingRegistration", cookieOptions);
  res.json({ message: "Logged out." });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Customer profile uses a separate self-service endpoint; email is intentionally immutable.
router.get("/customer-profile", requireAuth, requireRole("customer"), async (req, res) => {
  const user = await req.app.locals.db.collection("users").findOne({ _id: req.user._id }, { projection: { name:1,email:1,phone:1,photoUrl:1 } });
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user: { name: user.name, email: user.email, phone: user.phone || "", photoUrl: user.photoUrl || "" } });
});
router.patch("/customer-profile", requireAuth, requireRole("customer"), async (req, res) => {
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(req.body, "email")) return res.status(400).json({ error: "Email address cannot be changed." });
  if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
    const name = cleanText(req.body.name, 60);
    if (!validName(name)) return res.status(400).json({ error: "Enter a valid name (2 to 60 characters)." });
    changes.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
    const phone = cleanText(req.body.phone, 20);
    if (phone && !/^[+0-9() .-]{7,20}$/.test(phone)) return res.status(400).json({ error: "Enter a valid phone number." });
    changes.phone = phone;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "photoUrl")) {
    const photo = req.body.photoUrl;
    if (typeof photo !== "string" || photo.length > 750000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) return res.status(400).json({ error: "Invalid profile photo." });
    const bytes = Buffer.from(photo.slice(photo.indexOf(",")+1), "base64");
    if (bytes.length > 550000 || bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return res.status(400).json({ error: "Please upload a valid JPG photo." });
    changes.photoUrl = photo;
  }
  if (!Object.keys(changes).length) return res.status(400).json({ error: "Nothing to update." });
  changes.updatedAt = new Date();
  await req.app.locals.db.collection("users").updateOne({ _id:req.user._id, role:"customer", active:{ $ne:false } }, { $set:changes });
  await audit(req, "customer.profile-updated", { fields:Object.keys(changes).filter(k=>k!=="updatedAt") });
  res.json({ message: "Profile updated." });
});

// Ends every session of this account (other devices too) and keeps this one signed in.
async function bumpSessions(req, res, extra = {}) {
  const db = req.app.locals.db;
  const user = await db.collection("users").findOneAndUpdate(
    { _id: req.user._id },
    { $inc: { sessionVersion: 1 }, $set: { updatedAt: new Date(), ...extra } },
    { returnDocument: "after" }
  );

  await db.collection("trustedDevices").deleteMany({ userId: req.user._id });
  startSession(res, user);
  return user;
}

router.post("/change-password", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const currentPassword = String(req.body.currentPassword ?? "");
  const newPassword = String(req.body.newPassword ?? "");
  const isCustomer = req.user.role === "customer";

  if (isCustomer ? !basicPassword(newPassword) : !strongPassword(newPassword)) {
    return res.status(400).json({
      error: isCustomer
        ? "New password must be at least 8 characters with letters and numbers."
        : "New password must be at least 10 characters with upper and lower case letters, a number and a symbol."
    });
  }

  const user = await db.collection("users").findOne({ _id: req.user._id });
  if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: "Your current password is incorrect." });
  }

  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return res.status(400).json({ error: "Choose a password different from your current one." });
  }

  await bumpSessions(req, res, { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false });
  await audit(req, "password.changed");
  res.json({ message: "Password changed. Other devices have been signed out." });
});

router.post("/logout-everywhere", requireAuth, async (req, res) => {
  await bumpSessions(req, res);
  await audit(req, "sessions.ended");
  res.json({ message: "All other devices have been signed out, and remembered devices forgotten." });
});

// Customers can delete their account. Their name is removed from past visits; the visits stay in the shop's records.
router.post("/delete-account", requireAuth, requireRole("customer"), async (req, res) => {
  const db = req.app.locals.db;
  const user = await db.collection("users").findOne({ _id: req.user._id });

  if (!user || !await bcrypt.compare(String(req.body.password ?? ""), user.passwordHash)) {
    return res.status(400).json({ error: "Your password is incorrect." });
  }

  const label = "Deleted customer";
  await db.collection("users").updateOne(
    { _id: user._id },
    {
      $set: { name: label, email: `deleted-${user._id}@deleted.invalid`, phone: "", active: false, deletedAt: new Date() },
      $inc: { sessionVersion: 1 },
      $unset: { passwordHash: "" }
    }
  );
  await db.collection("queueTickets").updateMany({ customerId: user._id }, { $set: { customerName: label } });
  await db.collection("payments").updateMany({ customerId: user._id }, { $set: { customerName: label } });
  await db.collection("barberRatings").updateMany({ customerId: user._id }, { $set: { customerName: label } });
  await db.collection("queueTickets").updateMany(
    { customerId: user._id, status: { $in: ["waiting", "assigned"] } },
    { $set: { status: "cancelled", endedAt: new Date() } }
  );

  res.clearCookie("session", cookieOptions);
  res.json({ message: "Your account has been deleted." });
});

module.exports = router;
