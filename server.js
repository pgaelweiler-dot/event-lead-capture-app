// =========================
// server.js (FULL WORKING VERSION)
// =========================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import XLSX from "xlsx";

import { createOrUpdateTouchpoint } from "./services/touchpointService.js";
import { mapProtocolToHubSpot } from "./services/protocolMapper.js";
import { validateProtocol } from "./services/protocolValidator.js";
import { saveProtocol, getEventProtocols } from "./services/protocolStore.js";

import {
  buildSnapshot,
  getContactsSnapshot,
  getCompaniesSnapshot
} from "./services/snapshotService.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

// =========================
// CONTACT UPSERT (DEDUP)
// =========================
async function upsertContact(payload) {
  const properties = {};

  if (payload.extracted?.firstName) properties.firstname = payload.extracted.firstName;
  if (payload.extracted?.lastName) properties.lastname = payload.extracted.lastName;
  if (payload.extracted?.email) properties.email = payload.extracted.email;
  if (payload.extracted?.company) properties.company = payload.extracted.company;
  if (payload.extracted?.jobTitle) properties.jobtitle = payload.extracted.jobTitle;

  properties.n4f_contact_source_level_1 = "Marketing event";
  properties.n4f_contact_source_level_3 = "Booth Contacts";
  if (payload.meta?.event) {
    properties.n4f_lead_source_level_2_dd = payload.meta.event;
  }

  let contactId = payload.hubspotId;

  // EMAIL DEDUP
  if (!contactId && properties.email) {
    const searchRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "email",
            operator: "EQ",
            value: properties.email
          }]
        }],
        limit: 1
      })
    });

    const data = await searchRes.json();

    if (data.results?.length > 0) {
      contactId = data.results[0].id;
      console.log("🔁 Found existing contact:", contactId);
    }
  }

  if (contactId) {
    await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties })
    });

    return contactId;
  }

  const resCreate = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });

  const createData = await resCreate.json();
  return createData.id;
}

// =========================
// SNAPSHOT
// =========================
app.post("/admin/snapshot/build", async (req, res) => {
  try {
    const result = await buildSnapshot();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/snapshot/contacts", (req, res) => {
  res.json(getContactsSnapshot());
});

app.get("/snapshot/companies", (req, res) => {
  res.json(getCompaniesSnapshot());
});

// =========================
// EXPORT
// =========================
app.get("/admin/export/:event", (req, res) => {
  try {
    const data = getEventProtocols(req.params.event);

    const rows = data.records.map(r => ({
      protocolId: r.protocolId,
      contactId: r.contactId,
      touchpointId: r.touchpointId,
      ...r.payload?.meta,
      ...r.payload?.extracted,
      ...r.payload?.protocol
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Protocols");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", `attachment; filename=${req.params.event}.xlsx`);
    res.send(buffer);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    if (payload.protocolId) {
      saveProtocol({
        protocolId: payload.protocolId,
        contactId,
        touchpointId,
        payload,
        status: "synced"
      });
    }

    res.json({ success: true, contactId, touchpointId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// HEALTH
// =========================
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
