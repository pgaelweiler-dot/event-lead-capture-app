import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// =========================
// CACHE LAYER
// =========================
let contactsCache = [];
let lastSync = null;
let isSyncing = false;

// =========================
// CONFIG
// =========================
const HUBSPOT_URL = "https://api.hubapi.com/crm/v3/objects/contacts";

const HUBSPOT_LIST_IDS = (process.env.HUBSPOT_LIST_IDS || "19611")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "jobtitle",
  "phone",
  "company",
  "hs_email_hard_bounce_reason"
];

// =========================
// MIDDLEWARE
// =========================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => {
  res.send("Lead Sync API running");
});

// =========================
// FETCH LIST MEMBERS
// =========================
async function fetchListMembers(listId, after = null) {
  const url = new URL(`https://api.hubapi.com/crm/v3/lists/${listId}/memberships`);

  url.searchParams.append("limit", "100");
  if (after) url.searchParams.append("after", after);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.Private_App_Token}`
    }
  });

  return response.json();
}

// =========================
// FETCH CONTACTS
// =========================
async function fetchContactsByIds(ids) {
  const response = await fetch(`${HUBSPOT_URL}/batch/read`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.Private_App_Token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: PROPERTIES,
      associations: ["companies"],
      inputs: ids.map(id => ({ id }))
    })
  });

  return response.json();
}

// =========================
// FETCH COMPANIES
// =========================
async function fetchCompaniesByIds(ids) {
  const response = await fetch(
    "https://api.hubapi.com/crm/v3/objects/companies/batch/read",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.Private_App_Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: ["name", "n4f_email_patterns"],
        inputs: ids.map(id => ({ id }))
      })
    }
  );

  return response.json();
}

// =========================
// SYNC CONTACTS
// =========================
async function syncContacts() {
  if (isSyncing) {
    console.log("Sync already running, skipping...");
    return;
  }

  try {
    isSyncing = true;
    console.log("🔄 Starting HubSpot contact sync...");

    const allIdsSet = new Set();

    // 1. GET CONTACT IDS
    for (const listId of HUBSPOT_LIST_IDS) {
      let after = null;

      do {
        const data = await fetchListMembers(listId, after);

        (data.results || []).forEach(r => {
          if (r.recordId) allIdsSet.add(r.recordId);
        });

        after = data.paging?.next?.after || null;
      } while (after);
    }

    const allIds = Array.from(allIdsSet);
    console.log("Total IDs:", allIds.length);

    // 2. FETCH CONTACTS
    const chunkSize = 100;
    const rawContacts = [];
    const companyIdsSet = new Set();

    for (let i = 0; i < allIds.length; i += chunkSize) {
      const chunk = allIds.slice(i, i + chunkSize);
      const data = await fetchContactsByIds(chunk);

      (data.results || []).forEach(c => {
        console.log("Contact associations:", c.associations);
        rawContacts.push(c);

        const companyId = c.associations?.companies?.results?.[0]?.id;
        if (companyId) companyIdsSet.add(companyId);
      });
    }

   // 3. FETCH COMPANIES
const companyMap = {};
const companyIds = Array.from(companyIdsSet);

for (let i = 0; i < companyIds.length; i += chunkSize) {
  const chunk = companyIds.slice(i, i + chunkSize);
  const data = await fetchCompaniesByIds(chunk);

  (data.results || []).forEach(c => {
    // 🔍 DEBUG LOGS (ADD THESE)
    console.log("---- COMPANY DEBUG ----");
    console.log("Company ID:", c.id);
    console.log("Company name:", c.properties.name);
    console.log("RAW pattern field:", c.properties.n4f_email_patterns);

    let parsedPatterns = [];

    try {
      if (c.properties.n4f_email_patterns) {
        parsedPatterns = JSON.parse(c.properties.n4f_email_patterns);
      }
    } catch (err) {
      console.error("❌ JSON PARSE ERROR:", err.message);
      console.log("Problematic value:", c.properties.n4f_email_patterns);
    }

    console.log("Parsed patterns:", parsedPatterns);

    // ✅ FINAL OBJECT
    companyMap[c.id] = {
      name: c.properties.name,
      patterns: parsedPatterns
    };
  });
}

    // 4. MAP FINAL CONTACTS
    const allContacts = rawContacts.map(c => {
      const p = c.properties;
      const companyId = c.associations?.companies?.results?.[0]?.id;
      const companyData = companyMap[companyId] || {};

      return {
        id: c.id,
        first: p.firstname || "",
        last: p.lastname || "",
        email: p.email || "",

        company: companyData.name || p.company || "",
        companyPatterns: companyData.patterns || [],

        title: p.jobtitle || "",
        phone: p.phone || "",
        bounceReason: p.hs_email_hard_bounce_reason || null
      };
    });

    contactsCache = allContacts;
    lastSync = new Date();

    console.log("✅ Sync complete:", contactsCache.length);

  } catch (err) {
    console.error("🔴 Sync error:", err.message);
  } finally {
    isSyncing = false;
  }
}

// =========================
// ROUTES
// =========================
app.get("/contacts/preload", (req, res) => {
  res.json({
    lastSync,
    count: contactsCache.length,
    data: contactsCache
  });
});

app.get("/contacts/status", (req, res) => {
  res.json({
    isSyncing,
    lastSync,
    count: contactsCache.length
  });
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  syncContacts();
  setInterval(syncContacts, 1000 * 60 * 10);
});
