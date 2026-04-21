// =========================
// snapshotValidator.js
// =========================

export function validateContacts(contacts) {
  return contacts.map(c => ({
    id: c.id || null,
    first: c.first || "",
    last: c.last || "",
    email: c.email || "",
    company: c.company || "",
    title: c.title || "",
    phone: c.phone || "",
    language: normalizeLanguage(c.pd_language),
    emailBounceKnown: Boolean(c.emailBounceKnown),
    lastModified: c.lastModified || null
  }));
}

export function validateCompanies(companies) {
  return companies.map(c => ({
    id: c.id || null,
    name: c.name || "",
    domain: c.domain || "",
    additionalDomains: normalizeDomains(c.additionalDomains),
    patterns: Array.isArray(c.patterns) ? c.patterns : [],
    lastModified: c.lastModified || null
  }));
}

// =========================
// HELPERS
// =========================

function normalizeDomains(domains) {
  if (!domains) return [];

  if (typeof domains === "string") {
    return domains.split(";").map(d => d.trim()).filter(Boolean);
  }

  if (Array.isArray(domains)) {
    return domains;
  }

  return [];
}

function normalizeLanguage(lang) {
  const allowed = ["DE", "EN", "CN", "PT", "FRA", "ES"];
  if (!lang) return null;

  const upper = String(lang).toUpperCase();
  return allowed.includes(upper) ? upper : null;
}
