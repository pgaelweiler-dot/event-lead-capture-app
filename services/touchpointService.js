import fetch from "node-fetch";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;
const TOUCHPOINT_OBJECT_TYPE = "2-133310485";
const ASSOCIATION_TYPE = 22;

export async function createTouchpointAndAssociate(properties, contactId) {
  const tpRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT_TYPE}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });

  const tpData = await tpRes.json();

  console.log("🔵 Touchpoint response:", tpData);

  if (!tpRes.ok) {
    console.warn("⚠️ Touchpoint creation failed:", tpData);
  }

  const touchpointId = tpData.id;

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

  return touchpointId;
}
