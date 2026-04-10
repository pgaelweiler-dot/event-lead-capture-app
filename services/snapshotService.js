// =========================
// snapshotService.js (UPDATED: VERSIONING + pd_language)
// =========================
import fs from "fs";
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const CONTACTS_PATH = "./data/snapshots/contacts.json";
const COMPANIES_PATH = "./data/snapshots/companies.json";
const VERSION_PATH = "./data/snapshots/version.json";

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
// FETCH CONTACTS
// =========================
async function fetchAllContacts() {
  let results = [];
  let after = null;

  do {
    const url = new URL(`${HUBSPOT_BASE}/crm/v3/objects/contacts`);
    url.searchParams.append("limit", "100");
    if (after) url.searchParams.append("after", after);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`
      }
    });

    const data = await res.json();
    results.push(...(data.results || []));
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
    const url = new URL(`${HUBSPOT_BASE}/crm/v3/objects/companies`);
    url.searchParams.append("limit", "100");
    if (after) url.searchParams.append("after", after);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`
      }
    });

    const data = await res.json();
    results.push(...(data.results || []));
    after = data.paging?.next?.after;

  } while (after);

  return results;
}

// =========================
// BUILD SNAPSHOT
// =========================
export async function buildSnapshot() {
  console.log("🔄 Building snapshot...");

  const contactsRaw = await fetchAllContacts();

  const contacts = contactsRaw.map(c => ({
    id: c.id,
    first: c.properties.firstname,
    last: c.properties.lastname,
    email: c.properties.email,
    company: c.properties.company,
    domain: extractDomain(c.properties.email),
    pd_language: c.properties.pd_language || null // ✅ NEW
  }));

  saveFile(CONTACTS_PATH, contacts);
  console.log(`✅ Contacts snapshot: ${contacts.length}`);

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

  const version = new Date().toISOString();
  saveVersion(version);

  console.log(`🧾 Snapshot version: ${version}`);

  return {
    contacts: contacts.length,
    companies: companies.length,
    version
  };
}

export function getContactsSnapshot() {
  return JSON.parse(fs.readFileSync(CONTACTS_PATH));
}

export function getCompaniesSnapshot() {
  return JSON.parse(fs.readFileSync(COMPANIES_PATH));
}

export function getSnapshotVersion() {
  return getVersion();
}


// =========================
// SnapshotContext.jsx (REFactored: SINGLE CALL + VERSION-AWARE + INDEXED)
// =========================
import { createContext, useContext, useEffect, useState, useMemo } from "react";

const SnapshotContext = createContext();

const API_BASE = "https://lead-sync-backend.osc-fr1.scalingo.io";

const CACHE_KEY = "snapshot_full";
const VERSION_KEY = "snapshot_version";

export function SnapshotProvider({ children }) {
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSnapshot() {
      try {
        // =========================
        // 1. LOAD CACHE
        // =========================
        const cached = localStorage.getItem(CACHE_KEY);
        const cachedVersion = localStorage.getItem(VERSION_KEY);

        if (cached) {
          const parsed = JSON.parse(cached);
          setContacts(parsed.contacts || []);
          setCompanies(parsed.companies || []);
          setVersion(cachedVersion);

          console.log("⚡ Snapshot loaded from cache");
        }

        // =========================
        // 2. FETCH FROM BACKEND
        // =========================
        const res = await fetch(`${API_BASE}/snapshot/full`);

        if (!res.ok) throw new Error("Snapshot fetch failed");

        const data = await res.json();

        const backendVersion = data.version;

        // =========================
        // 3. VERSION CHECK
        // =========================
        if (backendVersion === cachedVersion) {
          console.log("⏭️ Snapshot up-to-date, skipping update");
          setLoading(false);
          return;
        }

        console.log("🔄 New snapshot version detected");

        // =========================
        // 4. UPDATE STATE
        // =========================
        setContacts(data.contacts || []);
        setCompanies(data.companies || []);
        setVersion(backendVersion);

        // =========================
        // 5. SAVE CACHE
        // =========================
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(VERSION_KEY, backendVersion);

        console.log("✅ Snapshot updated from backend", {
          contacts: data.contacts?.length,
          companies: data.companies?.length,
          version: backendVersion
        });

      } catch (err) {
        console.error("❌ Snapshot load failed:", err);
      } finally {
        setLoading(false);
      }
    }

    loadSnapshot();
  }, []);

  // =========================
  // INDEXES (PERFORMANCE)
  // =========================

  const emailMap = useMemo(() => {
    const map = new Map();
    contacts.forEach(c => {
      if (c.email) map.set(c.email.toLowerCase(), c);
    });
    return map;
  }, [contacts]);

  const domainMap = useMemo(() => {
    const map = {};
    companies.forEach(c => {
      if (c.domain) map[c.domain.toLowerCase()] = c;
    });
    return map;
  }, [companies]);

  const nameIndex = useMemo(() => {
    const map = new Map();
    contacts.forEach(c => {
      const key = `${c.first || ""}_${c.last || ""}`.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });
    return map;
  }, [contacts]);

  return (
    <SnapshotContext.Provider
      value={{
        contacts,
        companies,
        version,
        loading,
        emailMap,
        domainMap,
        nameIndex
      }}
    >
      {children}
    </SnapshotContext.Provider>
  );
}

export function useSnapshot() {
  return useContext(SnapshotContext);
}
