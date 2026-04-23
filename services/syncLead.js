// =========================
// syncLead.js (FULL SAFE VERSION)
// =========================

import { upsertContact } from "./contactService.js";
import { createOrUpdateTouchpoint } from "./touchpointService.js";
import { sendNotification } from "./emailService.js";

export async function handleSync(payload) {

  let contactResult;
  let touchpointId;

  try {

    // ================= CONTACT =================
    contactResult = await upsertContact(payload);

    const contactId = contactResult.id;

    if (!contactId) {
      throw new Error("Missing contactId after upsert");
    }

    // ================= TOUCHPOINT =================
    const touchpointIdResult = await createOrUpdateTouchpoint(
      payload,       // 🔥 keep mapping inside your service
      contactId,
      payload
    );

    touchpointId = touchpointIdResult;

    // ================= RESOLUTION =================
    const contactResolution =
      payload.hubspot?.contactId
        ? "Updated via ID"
        : contactResult.matchedByEmail
        ? "Matched by Email"
        : "New Contact";

    const touchpointResolution =
      payload.hubspot?.touchpointId
        ? "Updated"
        : "Created";

    // ================= EMAIL SUCCESS =================
    await sendNotification({
      subject: "✅ Lead Sync Success",
      text: `
Contact Email: ${payload.extracted?.email}

Contact ID: ${contactId}
Touchpoint ID: ${touchpointId}

Resolution:
- Contact: ${contactResolution}
- Touchpoint: ${touchpointResolution}

Event: ${payload.eventId || "n/a"}

Payload:
${JSON.stringify(payload, null, 2)}
`
    });

    return {
      contact: {
        success: true,
        id: contactId,
        matchedByEmail: contactResult.matchedByEmail
      },
      touchpoint: {
        success: true,
        id: touchpointId
      }
    };

  } catch (error) {

    console.error("❌ Sync failed:", error);

    // ================= EMAIL FAILURE =================
    await sendNotification({
      subject: "❌ Lead Sync Failure",
      text: `
Error: ${error.message}

Contact Email: ${payload.extracted?.email}

HubSpot IDs:
- Contact: ${payload.hubspot?.contactId || "none"}
- Touchpoint: ${payload.hubspot?.touchpointId || "none"}

Event: ${payload.eventId || "n/a"}

Payload:
${JSON.stringify(payload, null, 2)}
`
    });

    return {
      contact: { success: false },
      touchpoint: { success: false },
      error: error.message
    };
  }
}
