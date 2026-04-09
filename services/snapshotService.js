// =========================
// services/snapshotService.js
// =========================
import fs from "fs";
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const CONTACTS_PATH = "./data/snapshots/contacts.json";
const COMPANIES_PATH = "./data/snapshots/companies.json";

// 👉 MUST BE SET
const HUBSPOT_CONTACT_LIST_IDS = process.env.HUBSPOT_CONTACT_LIST_IDS?.split(",") || [];
const HUBSPOT_COMPANY_LIST_IDS = process.env.HUBSPOT_COMPANY_LIST_IDS?.split(",") || [];

// =========================
// HELPERS
// =========================
function saveFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function extractDomain(email) {
  if (!email) return null;
  return email.split("@")[1]?.toLowerCase() || null;
}

function chunkArray(arr, size = 100) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// =========================
// HUBSPOT HELPERS
// =========================
async function fetchListMembers(listId, after = null) {
  const url = new URL(`${HUBSPOT_BASE}/crm/v3/lists/${listId}/memberships`);

  url.searchParams.append("limit", "100");
  if (after) url.searchParams.append("after", after);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`
    }
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("❌ List fetch failed:", data);
    throw new Error("List fetch failed");
  }

  return data;
}

// -------------------------
// BATCH CONTACT FETCH
// -------------------------
async function fetchContactsByIds(ids) {
  const batches = chunkArray(ids, 100);
  let results = [];

  for (const batch of batches) {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/batch/read`, {
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
        inputs: batch.map(id => ({ id }))
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("❌ Contact batch fetch failed:", data);
      throw new Error("Contact batch fetch failed");
    }

    results.push(...(data.results || []));
  }

  return results;
}

// -------------------------
// BATCH COMPANY FETCH
// -------------------------
async function fetchCompaniesByIds(ids) {
  const batches = chunkArray(ids, 100);
  let results = [];

  for (const batch of batches) {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/companies/batch/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: [
          "name",
          "domain",
          "n4f_email_patterns"
        ],
        inputs: batch.map(id => ({ id }))
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("❌ Company batch fetch failed:", data);
      throw new Error("Company batch fetch failed");
    }

    results.push(...(data.results || []));
  }

  return results;
}

// =========================
// FETCH CONTACTS FROM LISTS
// =========================
async function fetchContactsFromLists() {
  let allIds = [];

  for (const listId of HUBSPOT_CONTACT_LIST_IDS) {
    console.log(`📥 Fetching contacts from list ${listId}`);

    let after = null;

    do {
      const data = await fetchListMembers(listId, after);
      const ids = data.results?.map(r => r.recordId) || [];

      allIds.push(...ids);
      after = data.paging?.next?.after || null;

    } while (after);
  }

  const uniqueIds = [...new Set(allIds)];
  console.log(`📊 Unique contact IDs: ${uniqueIds.length}`);

  const contactsRaw = await fetchContactsByIds(uniqueIds);

  return contactsRaw.map(c => ({
    id: c.id,
    first: c.properties.firstname || "",
    last: c.properties.lastname || "",
    email: c.properties.email || "",
    company: c.properties.company || "",
    title: c.properties.jobtitle || "",
    bounce: c.properties.hs_email_bounce,
    domain: extractDomain(c.properties.email)
  }));
}

// =========================
// FETCH COMPANIES FROM LISTS
// =========================
function parsePatterns(patternString) {
  if (!patternString) return [];
  return patternString.split(";").map(p => p.trim());
}

async function fetchCompaniesFromLists() {
  let allIds = [];

  for (const listId of HUBSPOT_COMPANY_LIST_IDS) {
    console.log(`📥 Fetching companies from list ${listId}`);

    let after = null;

    do {
      const data = await fetchListMembers(listId, after);
      const ids = data.results?.map(r => r.recordId) || [];

      allIds.push(...ids);
      after = data.paging?.next?.after || null;

    } while (after);
  }

  const uniqueIds = [...new Set(allIds)];
  console.log(`📊 Unique company IDs: ${uniqueIds.length}`);

  const companiesRaw = await fetchCompaniesByIds(uniqueIds);

  return companiesRaw.map(c => ({
    id: c.id,
    name: c.properties.name || "",
    domain: c.properties.domain || "",
    patterns: parsePatterns(c.properties.n4f_email_patterns)
  }));
}

// =========================
// BUILD SNAPSHOT
// =========================
export async function buildSnapshot() {
  console.log("🔄 Building snapshot (list-based)...");

  // CONTACTS
  const contacts = await fetchContactsFromLists();
  saveFile(CONTACTS_PATH, contacts);
  console.log(`✅ Contacts snapshot: ${contacts.length}`);

  // COMPANIES
  const companies = await fetchCompaniesFromLists();
  saveFile(COMPANIES_PATH, companies);
  console.log(`✅ Companies snapshot: ${companies.length}`);

  return {
    contacts: contacts.length,
    companies: companies.length
  };
}

// =========================
// GET SNAPSHOT
// =========================
export function getContactsSnapshot() {
  return JSON.parse(fs.readFileSync(CONTACTS_PATH));
}

export function getCompaniesSnapshot() {
  return JSON.parse(fs.readFileSync(COMPANIES_PATH));
}
