// =========================
// snapshotService.js (FULL SAFE VERSION)
// =========================
import fs from "fs";
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

// ✅ SAFE ENV HANDLING
const CONTACT_LIST_IDS = (process.env.HUBSPOT_CONTACT_LIST_IDS || "")
  .split(",")
  .filter(Boolean);

const COMPANY_LIST_IDS = (process.env.HUBSPOT_COMPANY_LIST_IDS || "")
  .split(",")
  .filter(Boolean);

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
  if (!ids || ids.length === 0) return { results: [] };

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

  const data = await res.json();

  if (!data.results) {
    console.error("❌ CONTACT FETCH FAILED:", data);
  }

  return data;
}

async function fetchCompaniesByIds(ids) {
  if (!ids || ids.length === 0) return { results: [] };

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

  const data = await res.json();

  if (!data.results) {
    console.error("❌ COMPANY FETCH FAILED:", data);
  }

  return data;
}

// =========================
// FULL BUILD (SAFE)
// =========================
export async function buildSnapshot() {
  if (!acquireLock()) throw new Error("Snapshot build already running");

  try {
    console.log("🔄 Full snapshot build...");

    if (!CONTACT_LIST_IDS.length) {
      throw new Error("No CONTACT_LIST_IDS configured");
    }

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

    console.log(`📊 Found ${uniqueContactIds.length} contacts`);

    const contactBatch = await fetchContactsByIds(uniqueContactIds);

    const contacts = (contactBatch.results || []).map(c => ({
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

    console.log(`📊 Found ${uniqueCompanyIds.length} companies`);

    const companyBatch = await fetchCompaniesByIds(uniqueCompanyIds);

    const companies = (companyBatch.results || []).map(c => ({
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

    console.log("✅ Snapshot build complete");

    return { contacts: contacts.length, companies: companies.length, version };

  } catch (err) {
    console.error("❌ Snapshot build failed:", err.message);
    throw err;
  } finally {
    releaseLock();
  }
}
