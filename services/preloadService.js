// =========================
// services/preloadService.js
// =========================
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const CONTACT_LIST_IDS = process.env.HUBSPOT_LIST_IDS?.split(",") || [];
const COMPANY_LIST_IDS = process.env.HUBSPOT_COMPANY_LIST_IDS?.split(",") || [];

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

// =========================
// CONTACT PRELOAD
// =========================
export async function preloadContacts(req, res) {
  try {
    let allIds = [];

    for (const listId of CONTACT_LIST_IDS) {
      let after = null;

      do {
        const data = await fetchListMembers(listId, after);
        const ids = data.results?.map(r => r.recordId) || [];

        allIds.push(...ids);
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const uniqueIds = [...new Set(allIds)];

    const batch = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
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
        inputs: uniqueIds.map(id => ({ id }))
      })
    }).then(r => r.json());

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
}

// =========================
// COMPANY PRELOAD
// =========================
export async function preloadCompanies(req, res) {
  try {
    let allIds = [];

    for (const listId of COMPANY_LIST_IDS) {
      let after = null;

      do {
        const data = await fetchListMembers(listId, after);
        const ids = data.results?.map(r => r.recordId) || [];

        allIds.push(...ids);
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const uniqueIds = [...new Set(allIds)];

    const batch = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/companies/batch/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: ["name", "n4f_email_patterns"],
        inputs: uniqueIds.map(id => ({ id }))
      })
    }).then(r => r.json());

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
}

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
