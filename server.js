// =========================
// server.js (FINAL FIXED SYNC)
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
  updateSnapshot,
  getContactsSnapshot,
  getCompaniesSnapshot,
  getSnapshotVersion
} from "./services/snapshotService.js";

import { startScheduler } from "./services/scheduler.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// SNAPSHOT
// =========================
app.get("/snapshot/full", async (req, res) => {
  res.json({
    version: await getSnapshotVersion(),
    contacts: await getContactsSnapshot(),
    companies: await getCompaniesSnapshot()
  });
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
// SYNC (FIXED)
// =========================
app.post("/sync/lead", async (req, res) => {
  const payload = req.body;

  let contactResult = null;
  let touchpointResult = null;

  try {
    const protocol = validateProtocol(payload.protocol);

    // CONTACT
    try {
      const contactId = await upsertContact(payload);
      contactResult = { success: true, id: contactId };

      const mapped = mapProtocolToHubSpot(protocol);

      // TOUCHPOINT
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
      }

    } catch (contactErr) {
      console.error("❌ Contact failed", contactErr);

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

    res.status(500).json({
      contact: { success: false },
      touchpoint: { success: false },
      error: err.message
    });
  }
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on", PORT);
  startScheduler();
});
