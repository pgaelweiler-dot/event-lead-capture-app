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

// Support multiple lists via env: HUBSPOT_LIST_IDS=19611,12345
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
  "company", // fallback
  "hs_email_hard_bounce_reason"
];

// =========================
// CORS
// =========================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("Lead Sync API running");
});

// =========================
// FETCH LIST MEMBERS (IDs)
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
// BATCH FETCH CONTACTS BY IDS
// =========================
async function fetchContactsByIds(ids) {
  const response = await fetch(
    `${HUBSPOT_URL}/batch/read`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.Private_App_Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: PROPERTIES,
        associations: ["companies"], // 👈 NEW
        inputs: ids.map(id => ({ id }))
      })
    }
  );

  return response.json();
}/batch/read`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.Private_App_Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: PROPERTIES,
        inputs: ids.map(id => ({ id }))
      })
    }
  );

  return response.json();
}

function mapContact(c) {
  const p = c.properties;

  // 👇 try to get primary associated company
  let associatedCompanyId = null;

  if (c.associations?.companies?.results?.length > 0) {
    associatedCompanyId = c.associations.companies.results[0].id;
  }

  return {
    id: c.id,
    first: p.firstname || "",
    last: p.lastname || "",
    email: p.email || "",

    // 👇 prefer associated company, fallback to text field
    company: associatedCompanyId || p.company || "",

    title: p.jobtitle || "",
    phone: p.phone || "",
    bounceReason: p.hs_email_hard_bounce_reason || null
  };
};
}

// =========================
// SYNC FUNCTION (MULTI-LIST)
// =========================
async function syncContacts() {
  if (isSyncing) {
    console.log("Sync already running, skipping...");
    return;
  }

  try {
    isSyncing = true;
    console.log("🔄 Starting HubSpot contact sync (MULTI-LIST + COMPANY)...");

    const allIdsSet = new Set();

    // 1) Collect contact IDs from all lists
    for (const listId of HUBSPOT_LIST_IDS) {
      console.log(`Processing list ${listId}...`);

      let after = null;
      let page = 1;

      do {
        const listData = await fetchListMembers(listId, after);

        (listData.results || []).forEach(r => {
          if (r.recordId) allIdsSet.add(r.recordId);
        });

        after = listData.paging?.next?.after || null;
        page++;

      } while (after);
    }

    const allIds = Array.from(allIdsSet);
    console.log(`Total unique contact IDs: ${allIds.length}`);

    // 2) Fetch contacts (with associations)
    const chunkSize = 100;
    let rawContacts = [];
    const companyIdsSet = new Set();

    for (let i = 0; i < allIds.length; i += chunkSize) {
      const chunk = allIds.slice(i, i + chunkSize);

      const contactsData = await fetchContactsByIds(chunk);

      (contactsData.results || []).forEach(c => {
        rawContacts.push(c);

        const companyId = c.associations?.companies?.results?.[0]?.id;
        if (companyId) companyIdsSet.add(companyId);
      });
    }

    console.log(`Collected ${companyIdsSet.size} company IDs`);

    // 3) Fetch companies
    const companyIds = Array.from(companyIdsSet);
    const companyMap = {};

    async function fetchCompaniesByIds(ids) {
      const res = await fetch(
        "https://api.hubapi.com/crm/v3/objects/companies/batch/read",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.Private_App_Token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            properties: ["name"],
            inputs: ids.map(id => ({ id }))
          })
        }
      );

      return res.json();
    }

    for (let i = 0; i < companyIds.length; i += chunkSize) {
      const chunk = companyIds.slice(i, i + chunkSize);
      const companiesData = await fetchCompaniesByIds(chunk);

      (companiesData.results || []).forEach(c => {
        companyMap[c.id] = c.properties.name;
      });
    }

    console.log(`Resolved ${Object.keys(companyMap).length} companies`);

    // 4) Final mapping
    const allContacts = rawContacts.map(c => {
      const p = c.properties;
      const companyId = c.associations?.companies?.results?.[0]?.id;

      return {
        id: c.id,
        first: p.firstname || "",
        last: p.lastname || "",
        email: p.email || "",

        // ✅ now real company name
        company: companyMap[companyId] || p.company || "",

        title: p.jobtitle || "",
        phone: p.phone || "",
        bounceReason: p.hs_email_hard_bounce_reason || null
      };
    });

    contactsCache = allContacts;
    lastSync = new Date();

    console.log(`✅ Sync complete (with companies): ${contactsCache.length} contacts`);

  } catch (err) {
    console.error("🔴 Sync error:", err.message);
  } finally {
    isSyncing = false;
  }
}

  try {
    isSyncing = true;
    console.log("🔄 Starting HubSpot contact sync (MULTI-LIST)...");

    const allIdsSet = new Set();

    // 1) Collect IDs from all lists
    for (const listId of HUBSPOT_LIST_IDS) {
      console.log(`Processing list ${listId}...`);

      let after = null;
      let page = 1;

      do {
        console.log(`List ${listId} → page ${page}`);

        const listData = await fetchListMembers(listId, after);

        (listData.results || []).forEach(r => {
          if (r.recordId) allIdsSet.add(r.recordId);
        });

        after = listData.paging?.next?.after || null;
        page++;

      } while (after);
    }

    const allIds = Array.from(allIdsSet);
    console.log(`Total unique IDs: ${allIds.length}`);

    // 2) Batch fetch contacts (chunked)
    const chunkSize = 100;
    let allContacts = [];

    for (let i = 0; i < allIds.length; i += chunkSize) {
      const chunk = allIds.slice(i, i + chunkSize);

      const contactsData = await fetchContactsByIds(chunk);
      const mapped = (contactsData.results || []).map(mapContact);

      allContacts.push(...mapped);
    }

    contactsCache = allContacts;
    lastSync = new Date();

    console.log(`✅ Sync complete (multi-list): ${contactsCache.length} contacts`);

  } catch (err) {
    console.error("🔴 Sync error:", err.message);
  } finally {
    isSyncing = false;
  }
}

// =========================
// PRELOAD (FROM CACHE)
// =========================
app.get("/contacts/preload", (req, res) => {
  res.json({
    lastSync,
    count: contactsCache.length,
    data: contactsCache
  });
});

// =========================
// STATUS ENDPOINT
// =========================
app.get("/contacts/status", (req, res) => {
  res.json({
    isSyncing,
    lastSync,
    count: contactsCache.length
  });
});

// =========================
// MAIN SYNC ENDPOINT (UNCHANGED)
// =========================
app.post("/sync/lead", async (req, res) => {
  const payload = req.body;

  try {
    const c = payload.extracted;

    if (!c) {
      return res.status(400).json({ error: "Missing contact data" });
    }

    const email = c.email?.trim();

    console.log("🔵 Incoming contact:", c);

    // UPDATE BY ID
    if (c.hubspotId) {
      const updateRes = await fetch(
        `${HUBSPOT_URL}/${c.hubspotId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.Private_App_Token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            properties: {
              firstname: c.firstName,
              lastname: c.lastName,
              email,
              company: c.company,
              jobtitle: c.jobTitle,
              phone: c.phoneNumber
            }
          })
        }
      );

      const data = await updateRes.json();

      if (!updateRes.ok) {
        return res.status(updateRes.status).json({ error: "Update by ID failed", details: data });
      }

      return res.json({ success: true, mode: "update_by_id", data });
    }

    if (!email) {
      return res.status(400).json({ error: "No email and no hubspotId" });
    }

    const searchRes = await fetch(`${HUBSPOT_URL}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.Private_App_Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }]
      })
    });

    const searchData = await searchRes.json();

    if (searchData.total > 0) {
      const contactId = searchData.results[0].id;

      const updateRes = await fetch(`${HUBSPOT_URL}/${contactId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.Private_App_Token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          properties: {
            firstname: c.firstName,
            lastname: c.lastName,
            email,
            company: c.company,
            jobtitle: c.jobTitle,
            phone: c.phoneNumber
          }
        })
      });

      const data = await updateRes.json();

      return res.json({ success: true, mode: "update_by_email", data });
    }

    const createRes = await fetch(HUBSPOT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.Private_App_Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: {
          firstname: c.firstName,
          lastname: c.lastName,
          email,
          company: c.company,
          jobtitle: c.jobTitle,
          phone: c.phoneNumber
        }
      })
    });

    const data = await createRes.json();

    return res.json({ success: true, mode: "create", data });

  } catch (err) {
    console.error("🔴 Server error:", err);
    res.status(500).json({ error: "Server error", message: err.message });
  }
});

// =========================
// START SERVER + AUTO SYNC
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  syncContacts();
  setInterval(syncContacts, 1000 * 60 * 10);
});
