// =========================
// scheduler.js (PRODUCTION)
// =========================
import cron from "node-cron";
import { updateSnapshot } from "./snapshotService.js";

let isRunning = false;

export function startScheduler() {
  console.log("🕒 Scheduler initialized");

  // ✅ RUN EVERY HOUR
  cron.schedule(
    "0 * * * *",
    async () => {
      if (isRunning) {
        console.log("⚠️ Snapshot already running, skipping...");
        return;
      }

      isRunning = true;

      console.log("🔄 Scheduled incremental snapshot update...");

      try {
        const result = await updateSnapshot();
        console.log("✅ Snapshot updated:", result);
      } catch (err) {
        console.error("❌ Snapshot update failed:", err.message);
      } finally {
        isRunning = false;
      }
    },
    {
      timezone: "Europe/Berlin"
    }
  );
}
