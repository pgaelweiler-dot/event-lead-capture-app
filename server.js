// =========================
// server.js (CLEAN)
// =========================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { preloadContacts, preloadCompanies } from "./services/preloadService.js";
import { upsertContact } from "./services/contactService.js";
import { createOrUpdateTouchpoint } from "./services/touchpointService.js";
import { validateProtocol } from "./services/protocolValidator.js";
import { mapProtocolToHubSpot } from "./services/protocolMapper.js";

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

    // 1. CONTACT UPSERT
    const contactId = await upsertContact(payload);

    // 2. PROTOCOL → TOUCHPOINT
    let touchpointProperties = {
      download_name: payload.meta?.event || "Event Interaction"
    };

    if (payload.protocol) {
      let validatedProtocol = payload.protocol;

      try {
        validatedProtocol = validateProtocol(payload.protocol);
      } catch (err) {
        console.warn("⚠️ Protocol validation warning:", err.message);
      }

      const mapped = mapProtocolToHubSpot(validatedProtocol);

      touchpointProperties = {
        ...touchpointProperties,
        ...mapped
      };

      console.log("Mapped Touchpoint Properties:", touchpointProperties);
    }

    // 3. CREATE TOUCHPOINT + ASSOCIATE
    const touchpointId = await createOrUpdateTouchpoint(
      touchpointProperties,
      contactId,
      payload
    );

    res.json({ success: true, contactId, touchpointId });

  } catch (err) {
    console.error("🔴 Sync error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
