// One-time, explicitly invoked password recovery for an existing cashier account.
// Does not create users or change seed.js behavior.
// Run from the backend directory after setting CASHIER_RESET_PASSWORD privately.
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");

async function main() {
  const email = String(process.env.CASHIER_EMAIL || "").trim().toLowerCase();
  const password = process.env.CASHIER_RESET_PASSWORD;
  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.DB_NAME || "barbershop";

  if (!uri || !email || !password) {
    throw new Error("MONGODB_URI, CASHIER_EMAIL, and CASHIER_RESET_PASSWORD are required. No data changed.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("CASHIER_EMAIL is not a valid email. No data changed.");
  }
  if (password.length < 10 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("New password must be 10–128 characters with upper/lowercase letters, a number and a symbol. No data changed.");
  }
  if (process.argv[2] !== "--confirm-reset") {
    throw new Error("To explicitly authorize resetting this cashier, rerun with --confirm-reset. No data changed.");
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(databaseName);
    const users = db.collection("users");
    const cashier = await users.findOne({ email, role: "cashier", active: { $ne: false } }, { projection: { _id: 1, email: 1 } });
    if (!cashier) throw new Error(`No active Cashier account found for ${email} in database '${databaseName}'. No data changed.`);

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await users.updateOne(
      { _id: cashier._id, email, role: "cashier", active: { $ne: false } },
      {
        $set: { passwordHash, mustChangePassword: true, updatedAt: new Date() },
        $inc: { sessionVersion: 1 },
        $unset: { failedLogins: "", lockedUntil: "" }
      }
    );
    if (result.modifiedCount !== 1) throw new Error("Cashier account was not updated; verify the account and database.");
    await db.collection("trustedDevices").deleteMany({ userId: cashier._id });
    console.log(`Cashier password reset for ${email} in '${databaseName}'. Existing sessions ended; change this one-time password after login.`);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(`Cashier reset failed: ${error.message}`);
  process.exitCode = 1;
});
