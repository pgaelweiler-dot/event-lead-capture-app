// =========================
// snapshotService.js (FINAL PRODUCTION)
// =========================
import fs from "fs";
import fetch from "node-fetch";

import {
  validateContacts,
  validateCompanies
} from "./snapshotValidator.js";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const CONTACT_LIST_IDS = (process.env.HUBSPOT_CONTACT_LIST_IDS || "").split(",").filter(Boolean);
const COMPANY_LIST_IDS = (process.env.HUBSPOT_COMPANY_LIST_IDS || "").split(",").filter(Boolean);

const CONTACTS_PATH = "./data/snapshots/contacts.json";
const COMPANIES_PATH = "./data/snapshots/companies.json";
const VERSION_PATH = "./data/snapshots/version.json";
const PROGRESS_PATH = "./data/snapshots/buildprogress.json";

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
// PROGRESS HANDLING
// =========================
function saveProgress(data) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(data, null, 2));
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function clearProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    fs.unlinkSync(PROGRESS_PATH);
  }
}

// =========================
// FETCH LIST MEMBERS (RESUMABLE)
// =========================
async function fetchListMembersResumable(listIds, type) {
  let progress = loadProgress();

  let allIds = [];
  let startListIndex = 0;
  let after = null;

  if (progress && progress.type === type) {
    console.log("♻️ Resuming", type);
    startListIndex = progress.listIndex;
    after = progress.after;
    allIds = progress.collectedIds || [];
  }

  for (let i = startListIndex; i < listIds.length; i++) {
    const listId = listIds[i];

    do {
      const url = new URL(`${HUBSPOT_BASE}/crm/v3/lists/${listId}/memberships`);
      url.searchParams.append("limit", "100");
      if (after) url.searchParams.append("after", after);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` }
      });

      const data = await res.json();

      const newIds = data.results?.map(r => r.recordId) || [];
      allIds.push(...newIds);

      after = data.paging?.next?.after || null;

      saveProgress({
        type,
        listIndex: i,
        after,
        collectedIds: allIds
      });

    } while (after);

    after = null;
  }

  clearProgress();

  return [...new Set(allIds)];
}

// =========================
// CHUNKED BATCH READ
// =========================
async function batchReadChunked(object, ids, properties, mapFn, path) {
  let results = [];

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);

    console.log(`📦 ${object} chunk ${i} → ${i + chunk.length}`);

    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${object}/batch/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties,
        inputs: chunk.map(id => ({ id }))
      })
    });

    const data = await res.json();
    results.push(...(data.results || []));

    // partial write
    const mapped = results.map(mapFn);

    if (object === "contacts") {
      writeJsonAtomic(path, validateContacts(mapped));
    } else {
      writeJsonAtomic(path, validateCompanies(mapped));
    }
  }

  return results;
}

// =========================
// MAPPING
// =========================
function mapContact(c) {
  return {
    id: c.id,
    first: c.properties.firstname || "",
    last: c.properties.lastname || "",
    email: c.properties.email || "",
    company: c.properties.company || "",
    title: c.properties.jobtitle || "",
    phone: c.properties.phone || "",
    pd_language: c.properties.pd_language || null,
    emailBounceKnown: !!bounceReason,
    lastModified: c.properties.hs_lastmodifieddate || null
  };
}

function mapCompany(c) {
  return {
    id: c.id,
    name: c.properties.name || "",
    domain: c.properties.domain || "",
    additionalDomains: c.properties.hs_additional_domains || "",
    patterns: c.properties.n4f_email_patterns
      ? c.properties.n4f_email_patterns.split(";")
      : [],
    lastModified: c.properties.hs_lastmodifieddate || null
  };
}

// =========================
// FULL BUILD
// =========================
export async function buildSnapshot() {
  console.log("🔄 FULL SNAPSHOT BUILD");

  const contactIds = await fetchListMembersResumable(CONTACT_LIST_IDS, "contacts");
  const companyIds = await fetchListMembersResumable(COMPANY_LIST_IDS, "companies");

  const contactsRaw = await batchReadChunked(
    "contacts",
    contactIds,
    [
      "firstname","lastname","email","company","jobtitle",
      "phone","pd_language","hs_lastmodifieddate","hs_email_hard_bounce_reason_enum"
    ],
    mapContact,
    CONTACTS_PATH
  );

  const companiesRaw = await batchReadChunked(
    "companies",
    companyIds,
    [
      "name","domain","hs_additional_domains",
      "n4f_email_patterns","hs_lastmodifieddate"
    ],
    mapCompany,
    COMPANIES_PATH
  );

  const contacts = validateContacts(contactsRaw.map(mapContact));
  const companies = validateCompanies(companiesRaw.map(mapCompany));

  const now = new Date().toISOString();

  writeJsonAtomic(CONTACTS_PATH, contacts);
  writeJsonAtomic(COMPANIES_PATH, companies);
  writeJsonAtomic(VERSION_PATH, {
    version: now,
    lastSync: now
  });

  return {
    contacts: contacts.length,
    companies: companies.length,
    version: now
  };
}

// =========================
// UPDATE (SMART MERGE)
// =========================
export async function updateSnapshot() {
  console.log("🔄 INCREMENTAL UPDATE");

  const version = readJsonSafe(VERSION_PATH);
  if (!version?.lastSync) {
    return await buildSnapshot();
  }

  const existingContacts = readJsonSafe(CONTACTS_PATH) || [];
  const existingCompanies = readJsonSafe(COMPANIES_PATH) || [];

  const contactMap = new Map(existingContacts.map(c => [c.id, c]));
  const companyMap = new Map(existingCompanies.map(c => [c.id, c]));

  const contactIds = await fetchListMembersResumable(CONTACT_LIST_IDS, "contacts");
  const companyIds = await fetchListMembersResumable(COMPANY_LIST_IDS, "companies");

  const contactsRaw = await batchReadChunked(
    "contacts",
    contactIds,
    [
      "firstname","lastname","email","company","jobtitle",
      "phone","pd_language","hs_lastmodifieddate"
    ],
    mapContact,
    CONTACTS_PATH
  );

  const companiesRaw = await batchReadChunked(
    "companies",
    companyIds,
    [
      "name","domain","hs_additional_domains",
      "n4f_email_patterns","hs_lastmodifieddate"
    ],
    mapCompany,
    COMPANIES_PATH
  );

  const updatedContacts = validateContacts(contactsRaw.map(mapContact));
  const updatedCompanies = validateCompanies(companiesRaw.map(mapCompany));

  for (const c of updatedContacts) contactMap.set(c.id, c);
  for (const c of updatedCompanies) companyMap.set(c.id, c);

  const now = new Date().toISOString();

  writeJsonAtomic(CONTACTS_PATH, Array.from(contactMap.values()));
  writeJsonAtomic(COMPANIES_PATH, Array.from(companyMap.values()));
  writeJsonAtomic(VERSION_PATH, {
    version: now,
    lastSync: now
  });

  return {
    contacts: contactMap.size,
    companies: companyMap.size
  };
}

// =========================
// GETTERS
// =========================
export function getContactsSnapshot() {
  return readJsonSafe(CONTACTS_PATH) || [];
}

export function getCompaniesSnapshot() {
  return readJsonSafe(COMPANIES_PATH) || [];
}

export function getSnapshotVersion() {
  return readJsonSafe(VERSION_PATH)?.version || null;
}
