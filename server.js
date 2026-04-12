// =========================
// server.js (FINAL CLEAN)
// =========================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import XLSX from "xlsx";

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

app.post("/admin/snapshot/build", async (req, res) => {
  res.json(await buildSnapshot());
});

app.post("/admin/snapshot/update", async (req, res) => {
  res.json(await updateSnapshot());
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
// SYNC
// =========================
app.post("/sync/lead", async (req, res) => {
  try {
    const payload = req.body;

    const protocol = validateProtocol(payload.protocol);
    const contactId = await upsertContact(payload);
    const mapped = mapProtocolToHubSpot(protocol);

    const touchpointId = await createOrUpdateTouchpoint(
      mapped,
      contactId,
      payload
    );

    const protocolId =
      payload.protocolId ||
      payload.id ||
      crypto.randomUUID();

    saveProtocol({
      protocolId,
      contactId,
      touchpointId,
      payload,
      status: "synced"
    });

    res.json({
      success: true,
      contactId,
      touchpointId
    });

  } catch (err) {
    console.error("❌ Sync failed", err);
    res.status(500).json({ success: false, error: err.message });
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
