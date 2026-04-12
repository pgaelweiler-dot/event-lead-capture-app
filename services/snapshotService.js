// =========================
// snapshotService.js (FINAL HYBRID + INCREMENTAL)
// =========================
import fs from "fs";
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const CONTACTS_PATH = "./data/snapshots/contacts.json";
const COMPANIES_PATH = "./data/snapshots/companies.json";
const VERSION_PATH = "./data/snapshots/version.json";

const GITHUB_BASE = process.env.SNAPSHOT_GITHUB_BASE;

// =========================
// FILE HELPERS
// =========================
function readJsonSafe(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(path, data) {
  const tmp = path + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, path);
}

// =========================
// GITHUB FALLBACK
// =========================
async function fetchFromGitHub(file) {
  if (!GITHUB_BASE) return null;

  try {
    const res = await fetch(`${GITHUB_BASE}/${file}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getSnapshotOrFallback(path, file) {
  const local = readJsonSafe(path);

  if (local && local.length) return local;

  console.log("⚠️ Loading snapshot from GitHub:", file);

  const remote = await fetchFromGitHub(file);

  if (remote) {
    writeJsonAtomic(path, remote);
    return remote;
  }

  return [];
}

// =========================
// PUBLIC GETTERS
// =========================
export async function getContactsSnapshot() {
  return await getSnapshotOrFallback(CONTACTS_PATH, "contacts.json");
}

export async function getCompaniesSnapshot() {
  return await getSnapshotOrFallback(COMPANIES_PATH, "companies.json");
}

export async function getSnapshotVersion() {
  const local = readJsonSafe(VERSION_PATH);
  if (local) return local.version;

  const remote = await fetchFromGitHub("version.json");
  return remote?.version || null;
}

// =========================
// FULL BUILD (FALLBACK)
// =========================
export async function buildSnapshot() {
  console.log("🔄 FULL snapshot rebuild");

  const contacts = await fetchUpdatedContacts("1970-01-01");
  const companies = await fetchUpdatedCompanies("1970-01-01");

  const version = new Date().toISOString();

  writeJsonAtomic(CONTACTS_PATH, contacts);
  writeJsonAtomic(COMPANIES_PATH, companies);
  writeJsonAtomic(VERSION_PATH, {
    version,
    lastSync: version
  });

  return { contacts: contacts.length, companies: companies.length, version };
}

// =========================
// INCREMENTAL UPDATE
// =========================
export async function updateSnapshot() {
  console.log("🔄 Incremental snapshot update");

  const lastSync = readJsonSafe(VERSION_PATH)?.lastSync;

  if (!lastSync) {
    console.log("⚠️ No baseline → full rebuild");
    return await buildSnapshot();
  }

  const updatedContacts = await fetchUpdatedContacts(lastSync);
  const updatedCompanies = await fetchUpdatedCompanies(lastSync);

  const existingContacts = readJsonSafe(CONTACTS_PATH) || [];
  const existingCompanies = readJsonSafe(COMPANIES_PATH) || [];

  const mergedContacts = mergeById(existingContacts, updatedContacts);
  const mergedCompanies = mergeById(existingCompanies, updatedCompanies);

  const version = new Date().toISOString();

  writeJsonAtomic(CONTACTS_PATH, mergedContacts);
  writeJsonAtomic(COMPANIES_PATH, mergedCompanies);
  writeJsonAtomic(VERSION_PATH, {
    version,
    lastSync: version
  });

  return {
    contacts: mergedContacts.length,
    companies: mergedCompanies.length,
    version
  };
}

// =========================
// MERGE
// =========================
function mergeById(existing, updates) {
  const map = new Map(existing.map(e => [e.id, e]));

  for (const u of updates) {
    map.set(u.id, u);
  }

  return Array.from(map.values());
}

// =========================
// FETCH UPDATED CONTACTS
// =========================
async function fetchUpdatedContacts(since) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: "hs_lastmodifieddate",
          operator: "GTE",
          value: since
        }]
      }],
      properties: [
        "firstname",
        "lastname",
        "email",
        "company",
        "jobtitle",
        "pd_language"
      ],
      limit: 100
    })
  });

  const data = await res.json();

  return (data.results || []).map(c => ({
    id: c.id,
    first: c.properties.firstname || "",
    last: c.properties.lastname || "",
    email: c.properties.email || "",
    company: c.properties.company || "",
    title: c.properties.jobtitle || "",
    pd_language: c.properties.pd_language || null
  }));
}

// =========================
// FETCH UPDATED COMPANIES
// =========================
async function fetchUpdatedCompanies(since) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/companies/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: "hs_lastmodifieddate",
          operator: "GTE",
          value: since
        }]
      }],
      properties: ["name", "domain", "n4f_email_patterns"],
      limit: 100
    })
  });

  const data = await res.json();

  return (data.results || []).map(c => ({
    id: c.id,
    name: c.properties.name,
    domain: c.properties.domain,
    patterns: c.properties.n4f_email_patterns
      ? c.properties.n4f_email_patterns.split(";")
      : []
  }));
}
