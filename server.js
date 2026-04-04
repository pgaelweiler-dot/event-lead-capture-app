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

const PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "company",
  "jobtitle",
  "phone",
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
// FETCH CONTACTS (PAGINATED)
// =========================
async function fetchContacts(after = null) {
  const url = new URL(HUBSPOT_URL);

  url.searchParams.append("limit", "100");
  url.searchParams.append("properties", PROPERTIES.join(","));

  if (after) {
    url.searchParams.append("after", after);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.Private_App_Token}`
    }
  });

  return response.json();
}

function mapContact(c) {
  const p = c.properties;

  return {
    id: c.id,
    first: p.firstname || "",
    last: p.lastname || "",
    email: p.email || "",
    company: p.company || "",
    title: p.jobtitle || "",
    phone: p.phone || "",
    bounceReason: p.hs_email_hard_bounce_reason || null
  };
}

// =========================
// SYNC FUNCTION
// =========================
async function syncContacts() {
  if (isSyncing) {
    console.log("Sync already running, skipping...");
    return;
  }

  try {
    isSyncing = true;
    console.log("🔄 Starting HubSpot contact sync...");

    let allContacts = [];
    let after = null;
    let page = 1;

    do {
      console.log(`Fetching page ${page}...`);

      const data = await fetchContacts(after);

      const mapped = data.results.map(mapContact);
      allContacts.push(...mapped);

      after = data.paging?.next?.after || null;
      page++;

    } while (after);

    contactsCache = allContacts;
    lastSync = new Date();

    console.log(`✅ Sync complete: ${contactsCache.length} contacts`);

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

    // =========================
    // UPDATE BY ID
    // =========================
    if (c.hubspotId) {
      console.log("🟢 Updating via ID:", c.hubspotId);

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
        return res.status(updateRes.status).json({
          error: "Update by ID failed",
          details: data
        });
      }

      return res.json({ success: true, mode: "update_by_id", data });
    }

    // =========================
    // EMAIL FALLBACK
    // =========================
    if (!email) {
      return res.status(400).json({
        error: "No email and no hubspotId"
      });
    }

    console.log("🟡 Falling back to email:", email);

    const searchRes = await fetch(
      `${HUBSPOT_URL}/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.Private_App_Token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: email
                }
              ]
            }
          ]
        })
      }
    );

    const searchData = await searchRes.json();

    if (searchData.total > 0) {
      const contactId = searchData.results[0].id;

      const updateRes = await fetch(
        `${HUBSPOT_URL}/${contactId}`,
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

      return res.json({
        success: true,
        mode: "update_by_email",
        data
      });
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

    res.status(500).json({
      error: "Server error",
      message: err.message
    });
  }
});

// =========================
// START SERVER + AUTO SYNC
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // initial sync
  syncContacts();

  // repeat sync every 10 min
  setInterval(syncContacts, 1000 * 60 * 10);
});
