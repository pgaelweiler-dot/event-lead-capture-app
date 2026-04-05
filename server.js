import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// =========================
// CONFIG
// =========================
const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const HUBSPOT_CONTACT_LIST_IDS = process.env.HUBSPOT_LIST_IDS?.split(",") || [];
const HUBSPOT_COMPANY_LIST_IDS = process.env.HUBSPOT_COMPANY_LIST_IDS?.split(",") || [];

const TOUCHPOINT_OBJECT_TYPE = "2-133310485";
const ASSOCIATION_TOUCHPOINT_TO_CONTACT = 22;

app.use(cors());
app.use(express.json());

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
// CONTACT PRELOAD (LIST)
// =========================
app.get("/contacts/preload", async (req, res) => {
  try {
    let allIds = [];

    for (const listId of HUBSPOT_CONTACT_LIST_IDS) {
      let after = null;

      do {
        const data = await fetchListMembers(listId, after);
        const ids = data.results?.map(r => r.recordId) || [];

        allIds.push(...ids);
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const uniqueIds = [...new Set(allIds)];

    const batch = await fetchContactsByIds(uniqueIds);

    const contacts = batch.results?.map(c => ({
      id: c.id,
      first: c.properties.firstname || "",
      last: c.properties.lastname || "",
      email: c.properties.email || "",
      company: c.properties.company || "",
      title: c.properties.jobtitle || "",
      bounce: c.properties.hs_email_bounce
    })) || [];

    console.log("✅ Contacts loaded:", contacts.length);

    res.json({ data: contacts, count: contacts.length });

  } catch (err) {
    console.error("🔴 Contact preload failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// COMPANY PRELOAD (LIST-BASED)
// =========================
app.get("/companies/preload", async (req, res) => {
  try {
    let allIds = [];

    for (const listId of HUBSPOT_COMPANY_LIST_IDS) {
      let after = null;

      do {
        const data = await fetchListMembers(listId, after);
        const ids = data.results?.map(r => r.recordId) || [];

        allIds.push(...ids);
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const uniqueIds = [...new Set(allIds)];

    const batch = await fetchCompaniesByIds(uniqueIds);

    const companies = batch.results?.map(c => ({
      name: c.properties.name,
      patterns: parsePatterns(c.properties.n4f_email_patterns)
    })) || [];

    console.log("✅ Companies loaded:", companies.length);

    res.json({ data: companies, count: companies.length });

  } catch (err) {
    console.error("🔴 Company preload failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// PATTERN PARSER
// =========================
function parsePatterns(raw) {
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// =========================
// SYNC (unchanged)
// =========================
app.post("/sync/lead", async (req, res) => {
  try {
    const payload = req.body;

    const properties = {};
    if (payload.extracted?.firstName) properties.firstname = payload.extracted.firstName;
    if (payload.extracted?.lastName) properties.lastname = payload.extracted.lastName;
    if (payload.extracted?.email) properties.email = payload.extracted.email;
    if (payload.extracted?.company) properties.company = payload.extracted.company;

    let contactId = payload.hubspotId;

    if (contactId) {
      await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });
    } else {
      const resCreate = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });

      const data = await resCreate.json();
      contactId = data.id;
    }

    const tpRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT_TYPE}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: {
          download_name: payload.meta?.event || "Event Interaction"
        }
      })
    });

    const tpData = await tpRes.json();
    const touchpointId = tpData.id;

    await fetch(`${HUBSPOT_BASE}/crm/v4/associations/${TOUCHPOINT_OBJECT_TYPE}/contacts/batch/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: [
          {
            from: { id: touchpointId },
            to: { id: contactId },
            types: [
              {
                associationCategory: "USER_DEFINED",
                associationTypeId: ASSOCIATION_TOUCHPOINT_TO_CONTACT
              }
            ]
          }
        ]
      })
    });

    res.json({ success: true, contactId, touchpointId });

  } catch (err) {
    console.error("🔴 Sync error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
