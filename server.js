import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// =========================
// CONFIG
// =========================
const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.Private_App_Token;

const TOUCHPOINT_OBJECT_TYPE = "2-133310485";
const ASSOCIATION_TOUCHPOINT_TO_CONTACT = 22;

// =========================
// MIDDLEWARE
// =========================
app.use(cors());
app.use(express.json());

// =========================
// HELPERS
// =========================
function mapToHubSpotProperties(payload) {
  const props = {};

  if (payload.extracted?.firstName) props.firstname = payload.extracted.firstName;
  if (payload.extracted?.lastName) props.lastname = payload.extracted.lastName;
  if (payload.extracted?.email) props.email = payload.extracted.email;
  if (payload.extracted?.company) props.company = payload.extracted.company;
  if (payload.extracted?.jobTitle) props.jobtitle = payload.extracted.jobTitle;

  return props;
}

// =========================
// TOUCHPOINT CREATION
// =========================
async function createTouchpoint(eventName) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/${TOUCHPOINT_OBJECT_TYPE}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: {
        download_name: eventName || "Event Interaction"
      }
    })
  });

  const data = await res.json();

  console.log("🟠 Created Touchpoint:", data);

  return data.id;
}

// =========================
// ASSOCIATION (REST - BULLETPROOF)
// =========================
async function associate(contactId, touchpointId) {
  console.log("🔗 Creating association (batch REST)...");

  const url = `${HUBSPOT_BASE}/crm/v4/associations/${TOUCHPOINT_OBJECT_TYPE}/contacts/batch/create`;

  const body = {
    inputs: [
      {
        from: { id: String(touchpointId) },
        to: { id: String(contactId) },
        types: [
          {
            associationCategory: "USER_DEFINED",
            associationTypeId: ASSOCIATION_TOUCHPOINT_TO_CONTACT
          }
        ]
      }
    ]
  };

  console.log("🔍 Association payload:", JSON.stringify(body, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  console.log("🔗 Association result:", data);
}

// =========================
// SYNC LEAD
// =========================
app.post("/sync/lead", async (req, res) => {
  try {
    const payload = req.body;

    console.log("\n================ SYNC START ================");
    console.log("🟣 FULL PAYLOAD:", JSON.stringify(payload, null, 2));

    const { hubspotId, email } = payload;

    console.log("🧭 Routing decision:", { hubspotId, email });

    const properties = mapToHubSpotProperties(payload);
    console.log("🧩 CONTACT PROPERTIES:", properties);

    let contactId = null;
    let mode = null;

    // =========================
    // CONTACT RESOLUTION
    // =========================
    if (hubspotId) {
      mode = "update_by_id";
      contactId = hubspotId;

      console.log("🟢 Updating contact by ID:", contactId);

      await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });

    } else {
      mode = "create_contact";
      console.log("🔵 Creating new contact");

      const resCreate = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });

      const data = await resCreate.json();
      contactId = data.id;

      console.log("🆕 Created contact ID:", contactId);
    }

    // =========================
    // TOUCHPOINT CREATION
    // =========================
    const eventName = payload.meta?.event || "Event Interaction";

    console.log("🟠 Creating touchpoint with name:", eventName);

    const touchpointId = await createTouchpoint(eventName);

    // =========================
    // ASSOCIATION
    // =========================
    if (contactId && touchpointId) {
      await associate(contactId, touchpointId);
    }

    console.log("✅ SYNC DONE MODE:", mode);
    console.log("===========================================\n");

    res.json({
      success: true,
      mode,
      contactId,
      touchpointId
    });

  } catch (err) {
    console.error("🔴 Sync error:", err.message);

    res.status(500).json({ error: err.message });
  }
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
