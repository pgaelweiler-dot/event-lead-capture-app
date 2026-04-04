import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// =========================
// CACHE
// =========================
let contactsCache = [];
let lastSync = null;
let isSyncing = false;

// =========================
// CONFIG
// =========================
const COMPANY_LIST_IDS = (process.env.HUBSPOT_COMPANY_LIST_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

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
// FETCH COMPANY LIST MEMBERS
// =========================
async function fetchCompanyListMembers(listId, after = null) {
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
// SYNC COMPANIES
// =========================
async function syncCompanies() {
  if (isSyncing) {
    console.log("Sync already running, skipping...");
    return;
  }

  try {
    isSyncing = true;
    console.log("🔄 Starting company sync...");

    const idSet = new Set();

    // 1. GET COMPANY IDS
    for (const listId of COMPANY_LIST_IDS) {
      console.log("Processing company list:", listId);

      let after = null;

      do {
        const data = await fetchCompanyListMembers(listId, after);

        (data.results || []).forEach(r => {
          if (r.recordId) idSet.add(r.recordId);
        });

        after = data.paging?.next?.after || null;

      } while (after);
    }

    const ids = Array.from(idSet);
    console.log("Total company IDs:", ids.length);

    // 2. FETCH COMPANIES
    const chunkSize = 100;
    const companies = [];

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const data = await fetchCompaniesByIds(chunk);

      (data.results || []).forEach(c => {
        console.log("---- COMPANY DEBUG ----");
        console.log("Company ID:", c.id);
        console.log("Company name:", c.properties.name);
        console.log("RAW pattern field:", c.properties.n4f_email_patterns);

        let patterns = [];

        try {
          if (c.properties.n4f_email_patterns) {
            patterns = JSON.parse(c.properties.n4f_email_patterns);
          }
        } catch (err) {
          console.error("❌ JSON PARSE ERROR:", err.message);
          console.log("Problematic value:", c.properties.n4f_email_patterns);
        }

        console.log("Parsed patterns:", patterns);

        if (patterns.length > 0) {
          companies.push({
            name: c.properties.name,
            patterns
          });
        }
      });
    }

    contactsCache = companies;
    lastSync = new Date();

    console.log("✅ Company sync complete:", companies.length);

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

  syncCompanies();
  setInterval(syncCompanies, 1000 * 60 * 10);
});
