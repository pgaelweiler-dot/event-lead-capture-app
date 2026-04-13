// =========================
// touchpointService.js (FINAL FIXED)
// =========================
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const TOUCHPOINT_OBJECT = "2-133310485";
const CONTACT_OBJECT = "0-1";

// ✅ your custom association
const ASSOCIATION_TYPE_ID = 23;

// =========================
// CREATE TOUCHPOINT (NO ASSOCIATION HERE)
// =========================
async function createTouchpoint(properties) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });

  const data = await res.json();

  if (!data.id) {
    console.error("❌ Touchpoint creation failed:", data);
    throw new Error("Touchpoint creation failed");
  }

  console.log("🟢 Created touchpoint:", data.id);
  return data.id;
}

// =========================
// ASSOCIATE CONTACT → TOUCHPOINT
// =========================
async function associateContactToTouchpoint(contactId, touchpointId) {
  const res = await fetch(
    `${HUBSPOT_BASE}/crm/v4/associations/${CONTACT_OBJECT}/${TOUCHPOINT_OBJECT}/batch/create`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: [
          {
            from: { id: contactId },
            to: { id: touchpointId },
            types: [
              {
                associationCategory: "USER_DEFINED",
                associationTypeId: ASSOCIATION_TYPE_ID
              }
            ]
          }
        ]
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("❌ Association failed:", err);
    throw new Error("Association failed");
  }

  console.log("🔗 Associated contact → touchpoint");
}

// =========================
// UPDATE TOUCHPOINT
// =========================
async function updateTouchpoint(id, properties) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT}/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("❌ Touchpoint update failed:", err);
    throw new Error("Touchpoint update failed");
  }

  console.log("🔁 Updated touchpoint:", id);
  return id;
}

// =========================
// MAIN FUNCTION
// =========================
export async function createOrUpdateTouchpoint(mappedProperties, contactId, payload) {

  let touchpointId = payload?.hubspot?.touchpointId;

  // UPDATE
  if (touchpointId) {
    console.log("➡️ Using existing touchpointId:", touchpointId);
    return await updateTouchpoint(touchpointId, mappedProperties);
  }

  // CREATE + ASSOCIATE
  console.log("➕ Creating new touchpoint (no ID)");

  const newId = await createTouchpoint(mappedProperties);

  await associateContactToTouchpoint(contactId, newId);

  return newId;
}
