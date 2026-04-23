// =========================
// contactService.js (UPDATED SAFE VERSION)
// =========================

import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

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

  if (payload.extracted?.language) {
    const lang = payload.extracted.language.toUpperCase();
    if (LANGUAGE_MAP[lang]) {
      properties.pd_language = LANGUAGE_MAP[lang];
    }
  }

  properties.n4f_conversion_url = "Leadscannerapp_Patrick";

  let contactId = payload.hubspot?.contactId;
  let matchedByEmail = false;

  // =========================
  // EMAIL MATCH (UNCHANGED BEHAVIOR)
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
      matchedByEmail = true;
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

    return {
      id: contactId,
      matchedByEmail,
      created: false
    };
  }

  // =========================
  // CREATE
  // =========================
  const createProperties = {
    ...properties,
    n4f_contact_source_level_1: "Marketing event",
    n4f_contact_source_level_3: "Booth Contacts"
  };

  const resCreate = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties: createProperties })
  });

  const createData = await resCreate.json();

  return {
    id: createData.id,
    matchedByEmail: false,
    created: true
  };
}
