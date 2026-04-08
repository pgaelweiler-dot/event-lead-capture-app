// =========================
// server.js (FULL UPDATED WITH EXPORT + DEDUP)
// =========================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import XLSX from "xlsx";
import fetch from "node-fetch";

import { createOrUpdateTouchpoint } from "./services/touchpointService.js";
import { mapProtocolToHubSpot } from "./services/protocolMapper.js";
import { validateProtocol } from "./services/protocolValidator.js";
import { preloadContacts, preloadCompanies } from "./services/preloadService.js";
import { saveProtocol, getEventProtocols } from "./services/protocolStore.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

// =========================
// CONTACT UPSERT (WITH EMAIL DEDUP)
// =========================
async function upsertContact(payload) {
  const properties = {};

  if (payload.extracted?.firstName) properties.firstname = payload.extracted.firstName;
  if (payload.extracted?.lastName) properties.lastname = payload.extracted.lastName;
  if (payload.extracted?.email) properties.email = payload.extracted.email;
  if (payload.extracted?.company) properties.company = payload.extracted.company;
  if (payload.extracted?.jobTitle) properties.jobtitle = payload.extracted.jobTitle;

  // enrichment
  properties.n4f_contact_source_level_1 = "Marketing event";
  properties.n4f_contact_source_level_3 = "Booth Contacts";
  if (payload.meta?.event) {
    properties.n4f_lead_source_level_2_dd = payload.meta.event;
  }

  let contactId = payload.hubspotId;

  // =========================
  // EMAIL LOOKUP (DEDUP)
  // =========================
  if (!contactId && properties.email) {
    const searchRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "email",
                operator: "EQ",
                value: properties.email
              }
            ]
          }
        ],
        limit: 1
      })
    });

    const searchData = await searchRes.json();

    if (searchData.results?.length > 0) {
      contactId = searchData.results[0].id;
      console.log("🔁 Found existing contact by email:", contactId);
    }
  }

  // =========================
  // UPDATE
  // =========================
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

  // =========================
  // CREATE
  // =========================
  const resCreate = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });

  const data = await resCreate.json();

  console.log("🟢 Contact create response:", {
    id: data.id,
    email: data.properties?.email
  });

  return data.id;
}

// =========================
// PRELOAD ROUTES
// =========================
app.get("/contacts/preload", preloadContacts);
app.get("/companies/preload", preloadCompanies);

// =========================
// EXPORT (EXCEL)
// =========================
app.get("/admin/export/:event", (req, res) => {
  try {
    const event = req.params.event;
    const data = getEventProtocols(event);

    if (!data || !data.records) {
      return res.status(404).json({ error: "No data found" });
    }

    const rows = data.records.map(r => ({
      protocolId: r.protocolId,
      contactId: r.contactId,
      touchpointId: r.touchpointId,
      event: r.payload?.meta?.event,
      user: r.payload?.meta?.user,
      quality: r.payload?.protocol?.quality_of_contact,
      topics: (r.payload?.protocol?.discussed_topics || []).join(", "),
      comments: r.payload?.protocol?.additional_comments,
      createdAt: r.payload?.meta?.createdAt
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Protocols");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx"
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${event}.xlsx`
    );

    res.send(buffer);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// SYNC ROUTE
// =========================
app.post("/sync/lead", async (req, res) => {
  try {
    const payload = req.body;

    const protocol = validateProtocol(payload.protocol);

    const contactId = await upsertContact(payload);

    const touchpointProperties = mapProtocolToHubSpot({
      ...protocol,
      protocolId: payload.protocolId
    });

    const touchpointId = await createOrUpdateTouchpoint(
      touchpointProperties,
      contactId,
      payload
    );

    if (payload.protocolId) {
      saveProtocol({
        protocolId: payload.protocolId,
        touchpointId,
        contactId,
        payload,
        status: "synced",
        updatedAt: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      contactId,
      touchpointId,
      protocolId: payload.protocolId
    });

  } catch (error) {
    console.error("🔴 Sync failed:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
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
  console.log(`Server running on ${PORT}`);
});
