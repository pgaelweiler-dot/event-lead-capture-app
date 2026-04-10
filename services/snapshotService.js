// =========================
// snapshotService.js (FINAL — LIST BASED + VERSIONING)
// =========================
import fs from "fs";
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

// ✅ USE YOUR EXISTING ENV CONFIG
const CONTACT_LIST_IDS = process.env.HUBSPOT_CONTACT_LIST_IDS.split(",");
const COMPANY_LIST_IDS = process.env.HUBSPOT_COMPANY_LIST_IDS.split(",");

const CONTACTS_PATH = "./data/snapshots/contacts.json";
const COMPANIES_PATH = "./data/snapshots/companies.json";
const VERSION_PATH = "./data/snapshots/version.json";

// =========================
// HELPERS
// =========================
function saveFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function saveVersion(version) {
  fs.writeFileSync(VERSION_PATH, JSON.stringify({ version }, null, 2));
}

function getVersion() {
  if (!fs.existsSync(VERSION_PATH)) return null;
  return JSON.parse(fs.readFileSync(VERSION_PATH)).version;
}

function extractDomain(email) {
  if (!email) return null;
  return email.split("@")[1]?.toLowerCase();
}

// =========================
// LIST MEMBERS (PAGINATED)
// =========================
async function fetchListMembers(listId, after = null) {
  const url = new URL(`${HUBSPOT_BASE}/crm/v3/lists/${listId}/memberships`);
  if (after) url.searchParams.append("after", after);
  url.searchParams.append("limit", "100");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`
    }
  });

  return res.json();
}

// =========================
// BATCH CONTACT FETCH
// =========================
async function fetchContactsByIds(ids) {
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
        "pd_language"
      ],
      inputs: ids.map(id => ({ id }))
    })
  });

  return res.json();
}

// =========================
// BATCH COMPANY FETCH
// =========================
async function fetchCompaniesByIds(ids) {
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
      inputs: ids.map(id => ({ id }))
    })
  });

  return res.json();
}

// =========================
// BUILD SNAPSHOT
// =========================
export async function buildSnapshot() {
  console.log("🔄 Building snapshot (list-based)...");

  // =========================
  // CONTACT IDS
  // =========================
  let contactIds = [];

  for (const listId of CONTACT_LIST_IDS) {
    let after = null;

    do {
      const data = await fetchListMembers(listId, after);
      const ids = data.results?.map(r => r.recordId) || [];

      contactIds.push(...ids);
      after = data.paging?.next?.after || null;

    } while (after);
  }

  const uniqueContactIds = [...new Set(contactIds)];
  console.log("📊 Unique contact IDs:", uniqueContactIds.length);

  // =========================
  // FETCH CONTACTS
  // =========================
  const contactBatch = await fetchContactsByIds(uniqueContactIds);

  const contacts = contactBatch.results?.map(c => ({
    id: c.id,
    first: c.properties.firstname || "",
    last: c.properties.lastname || "",
    email: c.properties.email || "",
    company: c.properties.company || "",
    title: c.properties.jobtitle || "",
    pd_language: c.properties.pd_language || null,
    domain: extractDomain(c.properties.email)
  })) || [];

  saveFile(CONTACTS_PATH, contacts);
  console.log(`✅ Contacts snapshot: ${contacts.length}`);

  // =========================
  // COMPANY IDS
  // =========================
  let companyIds = [];

  for (const listId of COMPANY_LIST_IDS) {
    let after = null;

    do {
      const data = await fetchListMembers(listId, after);
      const ids = data.results?.map(r => r.recordId) || [];

      companyIds.push(...ids);
      after = data.paging?.next?.after || null;

    } while (after);
  }

  const uniqueCompanyIds = [...new Set(companyIds)];
  console.log("📊 Unique company IDs:", uniqueCompanyIds.length);

  // =========================
  // FETCH COMPANIES
  // =========================
  const companyBatch = await fetchCompaniesByIds(uniqueCompanyIds);

  const companies = companyBatch.results?.map(c => ({
    id: c.id,
    name: c.properties.name,
    domain: c.properties.domain,
    patterns: c.properties.n4f_email_patterns
      ? c.properties.n4f_email_patterns.split(";")
      : []
  })) || [];

  saveFile(COMPANIES_PATH, companies);
  console.log(`✅ Companies snapshot: ${companies.length}`);

  // =========================
  // VERSION
  // =========================
  const version = new Date().toISOString();
  saveVersion(version);

  console.log(`🧾 Snapshot version: ${version}`);

  return {
    contacts: contacts.length,
    companies: companies.length,
    version
  };
}

// =========================
// EXPORTS
// =========================
export function getContactsSnapshot() {
  return JSON.parse(fs.readFileSync(CONTACTS_PATH));
}

export function getCompaniesSnapshot() {
  return JSON.parse(fs.readFileSync(COMPANIES_PATH));
}

export function getSnapshotVersion() {
  return getVersion();
}
