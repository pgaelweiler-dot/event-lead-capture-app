// =========================
// server.js (FINAL COMPLETE VERSION)
// =========================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import XLSX from "xlsx";
import crypto from "crypto";

import { createOrUpdateTouchpoint } from "./services/touchpointService.js";
import { mapProtocolToHubSpot } from "./services/protocolMapper.js";
import { validateProtocol } from "./services/protocolValidator.js";
import { saveProtocol, getEventProtocols } from "./services/protocolStore.js";
import { upsertContact } from "./services/contactService.js";

import {
  buildSnapshot,
  getContactsSnapshot,
  getCompaniesSnapshot,
  getSnapshotVersion
} from "./services/snapshotService.js";

import { startScheduler } from "./services/scheduler.js";
import { sendNotification } from "./services/emailService.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());


// =========================
// SNAPSHOT (PROTECTED)
// =========================
app.get("/snapshot/full", async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey || apiKey !== process.env.SNAPSHOT_API_KEY) {
      console.warn("🚫 Unauthorized snapshot access attempt");
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("🔐 Authorized snapshot access");

    res.json({
      version: await getSnapshotVersion(),
      contacts: await getContactsSnapshot(),
      companies: await getCompaniesSnapshot()
    });

  } catch (err) {
    console.error("❌ Snapshot error:", err);
    res.status(500).json({ error: "Snapshot failed" });
  }
});


// =========================
// EXPORT
// =========================
app.get("/admin/export/:event", (req, res) => {
  const data = getEventProtocols(req.params.event);

  const rows = data.records.map(r => ({
    protocolId: r.protocolId,
    contactId: r.contactId,
    touchpointId: r.touchpointId,
    ...r.payload.meta,
    ...r.payload.extracted,
    ...r.payload.protocol
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Protocols");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Disposition", `attachment; filename=${req.params.event}.xlsx`);
  res.send(buffer);
});


// =========================
// SYNC (CONTACT + TOUCHPOINT + EMAIL)
// =========================
app.post("/sync/lead", async (req, res) => {
  const payload = req.body;

  let contactResult = null;
  let touchpointResult = null;

  try {
    const protocol = validateProtocol(payload.protocol);

    // ================= CONTACT =================
    try {
      const contactResponse = await upsertContact(payload);

      const contactId =
        typeof contactResponse === "object"
          ? contactResponse.id
          : contactResponse;

      const matchedByEmail =
        typeof contactResponse === "object"
          ? contactResponse.matchedByEmail
          : false;

      contactResult = {
        success: true,
        id: contactId,
        matchedByEmail
      };

      const mapped = mapProtocolToHubSpot(protocol);

      // ================= TOUCHPOINT =================
      try {
        const touchpointId = await createOrUpdateTouchpoint(
          mapped,
          contactId,
          payload
        );

        touchpointResult = { success: true, id: touchpointId };

        saveProtocol({
          protocolId: payload.protocolId || crypto.randomUUID(),
          contactId,
          touchpointId,
          payload,
          status: "synced"
        });

        // ================= EMAIL SUCCESS =================
        await sendNotification({
          subject: "✅ Lead Sync Success",
          text: `
Contact Email: ${payload.extracted?.email}

Contact ID: ${contactId}
Touchpoint ID: ${touchpointId}

Resolution:
- Contact: ${
            payload.hubspot?.contactId
              ? "Updated via ID"
              : matchedByEmail
              ? "Matched by Email"
              : "New Contact"
          }
- Touchpoint: ${
            payload.hubspot?.touchpointId
              ? "Updated"
              : "Created"
          }

Event: ${payload.eventId || "n/a"}

Payload:
${JSON.stringify(payload, null, 2)}
`
        });

      } catch (tpErr) {
        console.error("❌ Touchpoint failed", tpErr);

        touchpointResult = {
          success: false,
          error: tpErr.message
        };

        saveProtocol({
          protocolId: payload.protocolId || crypto.randomUUID(),
          contactId,
          touchpointId: null,
          payload,
          status: "partial"
        });

        await sendNotification({
          subject: "⚠️ Touchpoint Sync Failed",
          text: `
Contact Email: ${payload.extracted?.email}
Contact ID: ${contactId}

Error: ${tpErr.message}

Payload:
${JSON.stringify(payload, null, 2)}
`
        });
      }

    } catch (contactErr) {
      console.error("❌ Contact failed", contactErr);

      await sendNotification({
        subject: "❌ Contact Sync Failed",
        text: `
Error: ${contactErr.message}

Contact Email: ${payload.extracted?.email}

Payload:
${JSON.stringify(payload, null, 2)}
`
      });

      return res.status(500).json({
        contact: { success: false, error: contactErr.message },
        touchpoint: { success: false }
      });
    }

    res.json({
      contact: contactResult,
      touchpoint: touchpointResult
    });

  } catch (err) {
    console.error("❌ Sync failed", err);

    await sendNotification({
      subject: "❌ Lead Sync Failure",
      text: `
Error: ${err.message}

Payload:
${JSON.stringify(payload, null, 2)}
`
    });

    res.status(500).json({
      contact: { success: false },
      touchpoint: { success: false },
      error: err.message
    });
  }
});


// =========================
// START SERVER + SNAPSHOT FRONTLOAD
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);

  // =========================
  // FRONTLOAD SNAPSHOT (NON-BLOCKING)
  // =========================
  console.log("📦 Starting initial snapshot build...");

  buildSnapshot()
    .then(() => console.log("✅ Initial snapshot ready"))
    .catch(err => console.error("❌ Initial snapshot failed:", err));

  // =========================
  // START SCHEDULER
  // =========================
  startScheduler();
});

