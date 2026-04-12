// =========================
// touchpointService.js (FINAL HARDENED)
// =========================
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const TOUCHPOINT_OBJECT = "2-133310485";

// =========================
// CREATE TOUCHPOINT
// =========================
async function createTouchpoint(properties, contactId) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties,
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: 3
            }
          ]
        }
      ]
    })
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
// SAFE FALLBACK RECOVERY
// =========================
async function findRecentTouchpoint(contactId, eventName) {
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - FIVE_DAYS).toISOString();

  console.warn("⚠️ Attempting touchpoint recovery...");
  console.log("🔎 Searching:", eventName, "since", cutoff);

  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "n4f_touchpoint_name_dd",
              operator: "EQ",
              value: eventName
            },
            {
              propertyName: "createdate",
              operator: "GTE",
              value: cutoff
            }
          ]
        }
      ],
      limit: 10
    })
  });

  const data = await res.json();

  if (!data.results) {
    console.error("❌ Recovery search failed:", data);
    return null;
  }

  for (const tp of data.results) {
    const assoc = tp.associations?.contacts?.results || [];

    if (assoc.some(c => c.id === contactId)) {
      console.log("🔁 Recovered touchpoint:", tp.id);
      return tp.id;
    }
  }

  console.warn("⚠️ No matching recent touchpoint found");

  return null;
}

// =========================
// MAIN FUNCTION
// =========================
export async function createOrUpdateTouchpoint(mappedProperties, contactId, payload) {

  let touchpointId = payload?.hubspot?.touchpointId;
  const eventName = mappedProperties.n4f_touchpoint_name_dd;

  if (!eventName) {
    throw new Error("Missing event_name → cannot process touchpoint");
  }

  // =========================
  // 1. PRIMARY: USE ID
  // =========================
  if (touchpointId) {
    console.log("➡️ Using existing touchpointId:", touchpointId);
    return await updateTouchpoint(touchpointId, mappedProperties);
  }

  // =========================
  // 2. FALLBACK: ONLY IF UPDATE
  // =========================
  if (payload?.needsUpdate) {
    const recovered = await findRecentTouchpoint(contactId, eventName);

    if (recovered) {
      return await updateTouchpoint(recovered, mappedProperties);
    }
  }

  // =========================
  // 3. DEFAULT: CREATE
  // =========================
  console.log("➕ Creating new touchpoint (no ID / no recovery)");

  return await createTouchpoint(mappedProperties, contactId);
}
