"use strict";
// Remove only records injected by the Renz Analytics demo generator.
// Preview: node scripts/removeAnalyticsDummyData.js
// Delete:  node scripts/removeAnalyticsDummyData.js --delete --confirm-renz-demo
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { MongoClient } = require("mongodb");
const BATCH = "renz-analytics-dummy-data-v1";
const COLLECTIONS = ["payments", "appointments", "queueTickets", "users"];
const confirmed = process.argv.includes("--delete") && process.argv.includes("--confirm-renz-demo");
if (!process.env.MONGODB_URI) { console.error("Missing MONGODB_URI environment variable."); process.exit(1); }
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "barbershop");
    console.log("Database:", db.databaseName, "| marker:", BATCH);
    const counts = {};
    for (const name of COLLECTIONS) counts[name] = await db.collection(name).countDocuments({ demoBatchId: BATCH });
    console.table(counts);
    if (!confirmed) {
      console.log("Preview only: nothing deleted. Back up your database before cleanup.");
      console.log("To remove ONLY these tagged records, run: node scripts/removeAnalyticsDummyData.js --delete --confirm-renz-demo");
      return;
    }
    // A second count is deliberately shown above before deletion. No blanket deletion.
    for (const name of COLLECTIONS) {
      const result = await db.collection(name).deleteMany({ demoBatchId: BATCH });
      console.log(`${name}: removed ${result.deletedCount}`);
    }
    // Remove only our explicit state record, not collection contents.
    await db.collection("demoDataState").deleteOne({ _id: BATCH });
    console.log("Cleanup complete. Restart/redeploy the restored original code and refresh Analytics.");
  } finally { await client.close(); }
})().catch(e => { console.error("Cleanup failed:", e.message); process.exitCode = 1; });
