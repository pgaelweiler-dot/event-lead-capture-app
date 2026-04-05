import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// =========================
// CACHE
// =========================
let companiesCache = [];
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

const CONTACT_LIST_IDS = (process.env.HUBSPOT_LIST_IDS || "")
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
// HUBSPOT HELPERS
// =========================
async function fetchListMembers(objectType, listId, after = null) {
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

async function fetchContactsByIds(ids) {
  const response = await fetch(
    "https://api.hubapi.com/crm/v3/objects/contacts/batch/read",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.Private_App_Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: [
          "firstname",
          "lastname",
          "email",
          "company",
          "jobtitle",
          "hs_email_bounce"
        ],
        inputs: ids.map(id => ({ id }))
      })
    }
  );

  return response.json();
}

// =========================
// SYNC
// =========================
async function syncData() {
  if (isSyncing) return;

  try {
    isSyncing = true;
    console.log("🔄 Starting sync...");

    // =========================
    // 1. COMPANIES (LIST-BASED)
    // =========================
    const companyIdSet = new Set();

    for (const listId of COMPANY_LIST_IDS) {
      let after = null;

      do {
        const data = await fetchListMembers("companies", listId, after);

        (data.results || []).forEach(r => {
          if (r.recordId) companyIdSet.add(r.recordId);
        });

        after = data.paging?.next?.after || null;
      } while (after);
    }

    const companyIds = Array.from(companyIdSet);

    const companies = [];
    const chunkSize = 100;

    for (let i = 0; i < companyIds.length; i += chunkSize) {
      const chunk = companyIds.slice(i, i + chunkSize);
      const data = await fetchCompaniesByIds(chunk);

      (data.results || []).forEach(c => {
        let patterns = [];

        try {
          if (c.properties.n4f_email_patterns) {
            patterns = JSON.parse(c.properties.n4f_email_patterns);
          }
        } catch {}

        companies.push({
          id: c.id,
          name: c.properties.name,
          patterns
        });
      });
    }

    companiesCache = companies;

    console.log("Companies synced:", companies.length);

    // =========================
    // 2. CONTACTS (LIST-BASED ✅ FIXED)
    // =========================
    const contactIdSet = new Set();

    for (const listId of CONTACT_LIST_IDS) {
      let after = null;

      do {
        const data = await fetchListMembers("contacts", listId, after);

        (data.results || []).forEach(r => {
          if (r.recordId) contactIdSet.add(r.recordId);
        });

        after = data.paging?.next?.after || null;
      } while (after);
    }

    const contactIds = Array.from(contactIdSet);

    const contacts = [];

    for (let i = 0; i < contactIds.length; i += chunkSize) {
      const chunk = contactIds.slice(i, i + chunkSize);
      const data = await fetchContactsByIds(chunk);

      (data.results || []).forEach(c => {
        contacts.push({
          id: c.id,
          first: c.properties.firstname || "",
          last: c.properties.lastname || "",
          email: c.properties.email || "",
          company: c.properties.company || "",
          title: c.properties.jobtitle || "",
          bounce: c.properties.hs_email_bounce === "true"
        });
      });
    }

    contactsCache = contacts;

    console.log("Contacts synced:", contacts.length);

    lastSync = new Date();

    console.log("✅ Sync complete");

  } catch (err) {
    console.error("🔴 Sync error:", err.message);
  } finally {
    isSyncing = false;
  }
}

// =========================
// ROUTES
// =========================
app.get("/companies/preload", (req, res) => {
  res.json({
    lastSync,
    count: companiesCache.length,
    data: companiesCache
  });
});

app.get("/contacts/preload", (req, res) => {
  res.json({
    lastSync,
    count: contactsCache.length,
    data: contactsCache
  });
});

app.get("/status", (req, res) => {
  res.json({
    isSyncing,
    lastSync,
    companies: companiesCache.length,
    contacts: contactsCache.length
  });
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  syncData();
  setInterval(syncData, 1000 * 60 * 10);
});
