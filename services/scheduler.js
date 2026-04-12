// =========================
// scheduler.js (FINAL)
// =========================
import cron from "node-cron";
import { updateSnapshot } from "./snapshotService.js";

let isRunning = false;

export function startScheduler() {
  console.log("🕒 Scheduler initialized");

  cron.schedule(
    "0 * * * *",
    async () => {
      if (isRunning) {
        console.log("⚠️ Snapshot already running");
        return;
      }

      isRunning = true;

      try {
        console.log("🔄 Running scheduled update...");
        await updateSnapshot();
        console.log("✅ Snapshot updated");
      } catch (err) {
        console.error("❌ Snapshot failed", err.message);
      } finally {
        isRunning = false;
      }
    },
    {
      timezone: "Europe/Berlin"
    }
  );
}
