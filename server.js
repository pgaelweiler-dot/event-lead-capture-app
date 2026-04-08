// =========================
// server.js (FULL UPDATED)
// =========================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { upsertContact } from "./services/contactService.js";
import { createOrUpdateTouchpoint } from "./services/touchpointService.js";
import { mapProtocolToHubSpot } from "./services/protocolMapper.js";
import { validateProtocol } from "./services/protocolValidator.js";
import { preloadContacts, preloadCompanies } from "./services/preloadService.js";
import { saveProtocol } from "./services/protocolStore.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// PRELOAD ROUTES
// =========================
app.get("/contacts/preload", preloadContacts);
app.get("/companies/preload", preloadCompanies);

// =========================
// SYNC ROUTE
// =========================
app.post("/sync/lead", async (req, res) => {
  try {
    const payload = req.body;

    // =========================
    // VALIDATE + NORMALIZE
    // =========================
    const protocol = validateProtocol(payload.protocol);

    // =========================
    // CONTACT UPSERT
    // =========================
    const contactId = await upsertContact(payload);

    // =========================
    // MAP TOUCHPOINT PROPERTIES
    // =========================
    const touchpointProperties = mapProtocolToHubSpot({
      ...protocol,
      protocolId: payload.protocolId
    });

    console.log("Mapped Touchpoint Properties:", touchpointProperties);

    // =========================
    // CREATE / UPDATE TOUCHPOINT
    // =========================
    const touchpointId = await createOrUpdateTouchpoint(
      touchpointProperties,
      contactId,
      payload
    );

    // =========================
    // STORE PROTOCOL (LOCAL STORAGE)
    // =========================
    if (payload.protocolId) {
      saveProtocol({
        protocolId: payload.protocolId,
        touchpointId,
        contactId,
        payload,
        status: "synced",
        updatedAt: new Date().toISOString()
      });
    }

    // =========================
    // RESPONSE
    // =========================
    res.json({
      success: true,
      contactId,
      touchpointId,
      protocolId: payload.protocolId
    });

  } catch (error) {
    console.error("🔴 Sync failed:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// HEALTH CHECK
// =========================
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
