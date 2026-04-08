import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

export async function upsertContact(payload) {
  const properties = {};

  if (payload.extracted?.firstName) properties.firstname = payload.extracted.firstName;
  if (payload.extracted?.lastName) properties.lastname = payload.extracted.lastName;
  if (payload.extracted?.email) properties.email = payload.extracted.email;
  if (payload.extracted?.company) properties.company = payload.extracted.company;
  if (payload.extracted?.jobTitle) properties.jobtitle = payload.extracted.jobTitle;

  let contactId = payload.hubspotId;

  if (contactId) {
    await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties })
    });

  } else {
    const createProperties = {
      ...properties,
      n4f_contact_source_level_1: "Marketing event",
      n4f_contact_source_level_3: "Booth Contacts",
      n4f_lead_source_level_2_dd: payload.protocol?.event_name || undefined
    };

    const resCreate = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties: createProperties })
    });

    const data = await resCreate.json();

    console.log("🟢 Contact create response:", data);

    if (!resCreate.ok) {
      console.warn("⚠️ Contact creation failed:", data);
    }

    contactId = data.id;
  }

  return contactId;
}
