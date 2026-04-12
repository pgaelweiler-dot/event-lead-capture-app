// =========================
// contactService.js (FINAL)
// =========================
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

// language mapping
const LANGUAGE_MAP = {
  DE: "DE",
  EN: "EN",
  CN: "CN",
  PT: "PT",
  FRA: "FRA",
  ES: "ES"
};

export async function upsertContact(payload) {
  const properties = {};

  if (payload.extracted?.firstName) properties.firstname = payload.extracted.firstName;
  if (payload.extracted?.lastName) properties.lastname = payload.extracted.lastName;
  if (payload.extracted?.email) properties.email = payload.extracted.email;
  if (payload.extracted?.company) properties.company = payload.extracted.company;
  if (payload.extracted?.jobTitle) properties.jobtitle = payload.extracted.jobTitle;

  // ✅ LANGUAGE MAPPING
  if (payload.extracted?.preferredLanguage) {
    const lang = payload.extracted.preferredLanguage.toUpperCase();
    if (LANGUAGE_MAP[lang]) {
      properties.pd_language = LANGUAGE_MAP[lang];
    }
  }

  properties.n4f_contact_source_level_1 = "Marketing event";
  properties.n4f_contact_source_level_3 = "Booth Contacts";

  if (payload.meta?.event) {
    properties.n4f_lead_source_level_2_dd = payload.meta.event;
  }

  let contactId = payload.hubspot?.contactId;

  // =========================
  // EMAIL DEDUP
  // =========================
  if (!contactId && properties.email) {
    const searchRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "email",
            operator: "EQ",
            value: properties.email
          }]
        }],
        limit: 1
      })
    });

    const data = await searchRes.json();

    if (data.results?.length > 0) {
      contactId = data.results[0].id;
      console.log("🔁 Found existing contact:", contactId);
    }
  }

  // =========================
  // UPDATE
  // =========================
  if (contactId) {
    await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties })
    });

    return contactId;
  }

  // =========================
  // CREATE
  // =========================
  const resCreate = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });

  const createData = await resCreate.json();

  console.log("🟢 Contact created:", createData.id);

  return createData.id;
}
