// =========================
// scheduler.js (SAFE VERSION)
// =========================
import cron from "node-cron";
import { buildSnapshot } from "./snapshotService.js";

let isRunning = false;

export function startScheduler() {
  console.log("🕒 Scheduler initialized");

  cron.schedule(
    "0 0 * * 5",
    async () => {
      if (isRunning) {
        console.log("⚠️ Snapshot already running, skipping...");
        return;
      }

      isRunning = true;
      console.log("⏰ Running scheduled snapshot build...");

      try {
        const result = await buildSnapshot();
        console.log("✅ Scheduled snapshot complete:", result);
      } catch (err) {
        console.error("❌ Scheduled snapshot failed:", err.message);
      } finally {
        isRunning = false;
      }
    },
    {
      timezone: "Europe/Berlin"
    }
  );
}
