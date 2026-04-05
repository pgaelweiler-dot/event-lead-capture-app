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

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

// =========================
// MIDDLEWARE
// =========================
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("Lead Sync API running"));

// =========================
// HELPERS
// =========================
async function fetchListMembers(listId, after = null) {
  const url = new URL(`${HUBSPOT_BASE}/crm/v3/lists/${listId}/memberships`);
  url.searchParams.append("limit", "100");
  if (after) url.searchParams.append("after", after);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  return response.json();
}

async function fetchCompaniesByIds(ids) {
  const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/companies/batch/read`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: ["name", "n4f_email_patterns"],
      inputs: ids.map(id => ({ id }))
    })
  });

  return response.json();
}

async function fetchContactsByIds(ids) {
  const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/batch/read`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: ["firstname", "lastname", "email", "company", "jobtitle", "hs_email_bounce"],
      inputs: ids.map(id => ({ id }))
    })
  });

  return response.json();
}

// =========================
// PROPERTY MAPPING
// =========================
const CONTACT_PROPERTY_MAP = {
  preferredLanguage: "preferred_language",
  interestLevel: "n4f_interest_level",
  followUpRequested: "n4f_follow_up_requested"
};

function mapToHubSpotProperties(payload) {
  const props = {};

  if (payload.extracted?.firstName) props.firstname = payload.extracted.firstName;
  if (payload.extracted?.lastName) props.lastname = payload.extracted.lastName;
  if (payload.extracted?.email) props.email = payload.extracted.email;
  if (payload.extracted?.company) props.company = payload.extracted.company;
  if (payload.extracted?.jobTitle) props.jobtitle = payload.extracted.jobTitle;

  for (const [frontendKey, hubspotKey] of Object.entries(CONTACT_PROPERTY_MAP)) {
    const value = payload.protocol?.[frontendKey];
    if (value !== undefined && value !== null) {
      props[hubspotKey] = value;
    }
  }

  return props;
}

// =========================
// SYNC
// =========================
async function syncData() {
  if (isSyncing) return;

  try {
    isSyncing = true;
    console.log("🔄 Starting sync...");

    // ---------- COMPANIES ----------
    const companyIdSet = new Set();

    for (const listId of COMPANY_LIST_IDS) {
      let after = null;
      do {
        const data = await fetchListMembers(listId, after);
        (data.results || []).forEach(r => r.recordId && companyIdSet.add(r.recordId));
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const companyIds = Array.from(companyIdSet);
    const companies = [];

    for (let i = 0; i < companyIds.length; i += 100) {
      const chunk = companyIds.slice(i, i + 100);
      const data = await fetchCompaniesByIds(chunk);

      (data.results || []).forEach(c => {
        let patterns = [];
        try {
          if (c.properties.n4f_email_patterns) {
            patterns = JSON.parse(c.properties.n4f_email_patterns);
          }
        } catch {}

        companies.push({ id: c.id, name: c.properties.name, patterns });
      });
    }

    companiesCache = companies;
    console.log("Companies synced:", companies.length);

    // ---------- CONTACTS ----------
    const contactIdSet = new Set();

    for (const listId of CONTACT_LIST_IDS) {
      let after = null;
      do {
        const data = await fetchListMembers(listId, after);
        (data.results || []).forEach(r => r.recordId && contactIdSet.add(r.recordId));
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const contactIds = Array.from(contactIdSet);
    const contacts = [];

    for (let i = 0; i < contactIds.length; i += 100) {
      const chunk = contactIds.slice(i, i + 100);
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
// SYNC LEAD (🔥 WITH DEBUGGING)
// =========================
app.post("/sync/lead", async (req, res) => {
  try {
    const payload = req.body;

    console.log("\n================ SYNC START ================");
    console.log("🟣 FULL PAYLOAD:", JSON.stringify(payload, null, 2));

    const { hubspotId, email } = payload;

    console.log("🧭 Routing decision:", { hubspotId, email });

    const properties = mapToHubSpotProperties(payload);
    console.log("🧩 MAPPED PROPERTIES:", properties);

    let mode = null;

    if (hubspotId) {
      mode = "update_by_id";
      console.log("🟢 Updating by ID:", hubspotId);

      await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${hubspotId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });

    } else if (email) {
      mode = "search_by_email";
      console.log("🟡 Searching by email:", email);

      // Simplified: create fallback
      await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });

    } else {
      mode = "create";
      console.log("🔵 Creating new contact");

      await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });
    }

    console.log("✅ SYNC DONE MODE:", mode);
    console.log("===========================================\n");

    res.json({ success: true, mode });

  } catch (err) {
    console.error("🔴 Sync error:", err.message);

    res.status(500).json({ error: err.message });
  }
});

// =========================
// ROUTES
// =========================
app.get("/companies/preload", (req, res) => {
  res.json({ lastSync, count: companiesCache.length, data: companiesCache });
});

app.get("/contacts/preload", (req, res) => {
  res.json({ lastSync, count: contactsCache.length, data: contactsCache });
});

app.get("/status", (req, res) => {
  res.json({ isSyncing, lastSync, companies: companiesCache.length, contacts: contactsCache.length });
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
