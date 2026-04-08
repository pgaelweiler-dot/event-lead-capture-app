// =========================
// services/touchpointService.js
// =========================
import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;
const TOUCHPOINT_OBJECT_TYPE = "2-133310485";
const ASSOCIATION_TYPE = 22;

// =========================
// CREATE WITH RETRY (GRACEFUL)
// =========================
async function createWithFallback(properties) {
  let attemptProps = { ...properties };

  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT_TYPE}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties: attemptProps })
    });

    const data = await res.json();

    console.log("🔵 Touchpoint attempt:", attemptProps);
    console.log("🔵 Response:", data);

    if (res.ok) return data;

    // Remove invalid fields and retry
    if (data?.errors) {
      for (const err of data.errors) {
        const field = err.context?.name;

        if (field && attemptProps[field]) {
          console.warn("⚠️ Removing invalid field:", field);
          delete attemptProps[field];
        }
      }
    } else {
      break;
    }
  }

  return null;
}

// =========================
// MAIN FUNCTION
// =========================
export async function createOrUpdateTouchpoint(properties, contactId, payload) {

  // =========================
  // ADD PROTOCOL ID
  // =========================
  if (payload?.protocolId) {
    properties.n4f_protocol_id = payload.protocolId;
  }

  let touchpointId = payload?.touchpointId;

  // =========================
  // UPDATE EXISTING
  // =========================
  if (touchpointId) {
    const updateRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT_TYPE}/${touchpointId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties })
    });

    const updateData = await updateRes.json();

    console.log("🟡 Touchpoint update response:", updateData);

    if (!updateRes.ok) {
      console.warn("⚠️ Update failed → fallback to create");
      touchpointId = null;
    }
  }

  // =========================
  // CREATE NEW (WITH RETRY)
  // =========================
  if (!touchpointId) {
    const tpData = await createWithFallback(properties);

    if (!tpData || !tpData.id) {
      console.warn("❌ Touchpoint creation failed completely");
      return null;
    }

    touchpointId = tpData.id;

    // =========================
    // ASSOCIATE CONTACT
    // =========================
    await fetch(`${HUBSPOT_BASE}/crm/v4/associations/${TOUCHPOINT_OBJECT_TYPE}/contacts/batch/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: [
          {
            from: { id: touchpointId },
            to: { id: contactId },
            types: [
              {
                associationCategory: "USER_DEFINED",
                associationTypeId: ASSOCIATION_TYPE
              }
            ]
          }
        ]
      })
    });
  }

  return touchpointId;
}
