// =========================
// snapshotService.js (FULL + INCREMENTAL)
// =========================
import fs from "fs";
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const CONTACT_LIST_IDS = process.env.HUBSPOT_CONTACT_LIST_IDS.split(",");
const COMPANY_LIST_IDS = process.env.HUBSPOT_COMPANY_LIST_IDS.split(",");

const CONTACTS_PATH = "./data/snapshots/contacts.json";
const COMPANIES_PATH = "./data/snapshots/companies.json";
const VERSION_PATH = "./data/snapshots/version.json";
const LOCK_PATH = "./data/snapshots/build.lock";

// =========================
// FILE SAFETY
// =========================
function writeJsonAtomic(filePath, data) {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function readJsonSafe(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// =========================
// LOCKING
// =========================
function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) return false;
  fs.writeFileSync(LOCK_PATH, "locked");
  return true;
}

function releaseLock() {
  if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
}

// =========================
// HELPERS
// =========================
function extractDomain(email) {
  return email?.split("@")[1]?.toLowerCase() || null;
}

function getVersionData() {
  return readJsonSafe(VERSION_PATH) || null;
}

// =========================
// HUBSPOT HELPERS
// =========================
async function fetchListMembers(listId, after = null) {
  const url = new URL(`${HUBSPOT_BASE}/crm/v3/lists/${listId}/memberships`);
  if (after) url.searchParams.append("after", after);
  url.searchParams.append("limit", "100");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  return res.json();
}

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
        "pd_language",
        "hs_lastmodifieddate"
      ],
      inputs: ids.map(id => ({ id }))
    })
  });

  return res.json();
}

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
        "n4f_email_patterns",
        "hs_lastmodifieddate"
      ],
      inputs: ids.map(id => ({ id }))
    })
  });

  return res.json();
}

// =========================
// FULL BUILD (unchanged logic, but safe)
// =========================
export async function buildSnapshot() {
  if (!acquireLock()) throw new Error("Snapshot build already running");

  try {
    console.log("🔄 Full snapshot build...");

    let contactIds = [];
    for (const listId of CONTACT_LIST_IDS) {
      let after = null;
      do {
        const data = await fetchListMembers(listId, after);
        contactIds.push(...(data.results?.map(r => r.recordId) || []));
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const uniqueContactIds = [...new Set(contactIds)];
    const contactBatch = await fetchContactsByIds(uniqueContactIds);

    const contacts = contactBatch.results.map(c => ({
      id: c.id,
      first: c.properties.firstname || "",
      last: c.properties.lastname || "",
      email: c.properties.email || "",
      company: c.properties.company || "",
      title: c.properties.jobtitle || "",
      pd_language: c.properties.pd_language || null,
      domain: extractDomain(c.properties.email)
    }));

    let companyIds = [];
    for (const listId of COMPANY_LIST_IDS) {
      let after = null;
      do {
        const data = await fetchListMembers(listId, after);
        companyIds.push(...(data.results?.map(r => r.recordId) || []));
        after = data.paging?.next?.after || null;
      } while (after);
    }

    const uniqueCompanyIds = [...new Set(companyIds)];
    const companyBatch = await fetchCompaniesByIds(uniqueCompanyIds);

    const companies = companyBatch.results.map(c => ({
      id: c.id,
      name: c.properties.name,
      domain: c.properties.domain,
      patterns: c.properties.n4f_email_patterns
        ? c.properties.n4f_email_patterns.split(";")
        : []
    }));

    const version = new Date().toISOString();

    writeJsonAtomic(CONTACTS_PATH, contacts);
    writeJsonAtomic(COMPANIES_PATH, companies);
    writeJsonAtomic(VERSION_PATH, { version, lastSync: version });

    return { contacts: contacts.length, companies: companies.length, version };

  } finally {
    releaseLock();
  }
}

// =========================
// INCREMENTAL UPDATE
// =========================
export async function updateSnapshot() {
  if (!acquireLock()) throw new Error("Snapshot update already running");

  try {
    console.log("🔄 Incremental snapshot update...");

    const existingContacts = readJsonSafe(CONTACTS_PATH) || [];
    const existingCompanies = readJsonSafe(COMPANIES_PATH) || [];
    const versionData = getVersionData();

    if (!versionData) {
      console.log("⚠️ No snapshot found → running full build");
      return buildSnapshot();
    }

    const lastSync = versionData.lastSync;

    const contactMap = new Map(existingContacts.map(c => [c.id, c]));
    const companyMap = new Map(existingCompanies.map(c => [c.id, c]));

    // =========================
    // LIST MEMBERSHIP
    // =========================
    let currentContactIds = [];
    for (const listId of CONTACT_LIST_IDS) {
      let after = null;
      do {
        const data = await fetchListMembers(listId, after);
        currentContactIds.push(...(data.results?.map(r => r.recordId) || []));
        after = data.paging?.next?.after || null;
      } while (after);
    }

    currentContactIds = [...new Set(currentContactIds)];
    const currentSet = new Set(currentContactIds);

    // =========================
    // REMOVE deleted
    // =========================
    for (const id of contactMap.keys()) {
      if (!currentSet.has(id)) {
        contactMap.delete(id);
      }
    }

    // =========================
    // FETCH UPDATED / NEW
    // =========================
    const CHUNK_SIZE = 100;

    for (let i = 0; i < currentContactIds.length; i += CHUNK_SIZE) {
      const chunk = currentContactIds.slice(i, i + CHUNK_SIZE);
      const batch = await fetchContactsByIds(chunk);

      batch.results.forEach(c => {
        const modified = c.properties.hs_lastmodifieddate;

        if (!lastSync || modified > lastSync || !contactMap.has(c.id)) {
          contactMap.set(c.id, {
            id: c.id,
            first: c.properties.firstname || "",
            last: c.properties.lastname || "",
            email: c.properties.email || "",
            company: c.properties.company || "",
            title: c.properties.jobtitle || "",
            pd_language: c.properties.pd_language || null,
            domain: extractDomain(c.properties.email)
          });
        }
      });
    }

    // =========================
    // COMPANIES (same logic)
    // =========================
    let currentCompanyIds = [];
    for (const listId of COMPANY_LIST_IDS) {
      let after = null;
      do {
        const data = await fetchListMembers(listId, after);
        currentCompanyIds.push(...(data.results?.map(r => r.recordId) || []));
        after = data.paging?.next?.after || null;
      } while (after);
    }

    currentCompanyIds = [...new Set(currentCompanyIds)];
    const companySet = new Set(currentCompanyIds);

    for (const id of companyMap.keys()) {
      if (!companySet.has(id)) companyMap.delete(id);
    }

    for (let i = 0; i < currentCompanyIds.length; i += CHUNK_SIZE) {
      const chunk = currentCompanyIds.slice(i, i + CHUNK_SIZE);
      const batch = await fetchCompaniesByIds(chunk);

      batch.results.forEach(c => {
        const modified = c.properties.hs_lastmodifieddate;

        if (!lastSync || modified > lastSync || !companyMap.has(c.id)) {
          companyMap.set(c.id, {
            id: c.id,
            name: c.properties.name,
            domain: c.properties.domain,
            patterns: c.properties.n4f_email_patterns
              ? c.properties.n4f_email_patterns.split(";")
              : []
          });
        }
      });
    }

    const contacts = Array.from(contactMap.values());
    const companies = Array.from(companyMap.values());

    const version = new Date().toISOString();

    writeJsonAtomic(CONTACTS_PATH, contacts);
    writeJsonAtomic(COMPANIES_PATH, companies);
    writeJsonAtomic(VERSION_PATH, { version, lastSync: version });

    console.log("✅ Incremental update complete");

    return { contacts: contacts.length, companies: companies.length, version };

  } finally {
    releaseLock();
  }
}

// =========================
// EXPORTS
// =========================
export function getContactsSnapshot() {
  return readJsonSafe(CONTACTS_PATH);
}

export function getCompaniesSnapshot() {
  return readJsonSafe(COMPANIES_PATH);
}

export function getSnapshotVersion() {
  return getVersionData()?.version || null;
}
