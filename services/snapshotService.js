// =========================
// services/snapshotService.js
// =========================
import fs from "fs";
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const CONTACTS_PATH = "./data/snapshots/contacts.json";
const COMPANIES_PATH = "./data/snapshots/companies.json";

// =========================
// HELPERS
// =========================
function saveFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function extractDomain(email) {
  if (!email) return null;
  return email.split("@")[1]?.toLowerCase();
}

// =========================
// FETCH CONTACTS (PAGINATED)
// =========================
async function fetchAllContacts() {
  let results = [];
  let after = null;

  do {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`
      },
      qs: {
        limit: 100,
        after
      }
    });

    const data = await res.json();

    results.push(...data.results);

    after = data.paging?.next?.after;

  } while (after);

  return results;
}

// =========================
// FETCH COMPANIES
// =========================
async function fetchAllCompanies() {
  let results = [];
  let after = null;

  do {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/companies`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`
      }
    });

    const data = await res.json();

    results.push(...data.results);

    after = data.paging?.next?.after;

  } while (after);

  return results;
}

// =========================
// BUILD SNAPSHOT
// =========================
export async function buildSnapshot() {
  console.log("🔄 Building snapshot...");

  // CONTACTS
  const contactsRaw = await fetchAllContacts();

  const contacts = contactsRaw.map(c => ({
    id: c.id,
    first: c.properties.firstname,
    last: c.properties.lastname,
    email: c.properties.email,
    company: c.properties.company,
    domain: extractDomain(c.properties.email)
  }));

  saveFile(CONTACTS_PATH, contacts);

  console.log(`✅ Contacts snapshot: ${contacts.length}`);

  // COMPANIES
  const companiesRaw = await fetchAllCompanies();

  const companies = companiesRaw.map(c => ({
    id: c.id,
    name: c.properties.name,
    domain: c.properties.domain,
    patterns: c.properties.n4f_email_patterns
      ? c.properties.n4f_email_patterns.split(";")
      : []
  }));

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
