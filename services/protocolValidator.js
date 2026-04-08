// =========================
// services/protocolValidator.js
// =========================
import {
  VALID_QUALITY,
  VALID_TOPICS,
  VALID_BUSINESS_LINES,
  VALID_USERS,
  VALID_EVENTS
} from "./protocolConfig.js";

// =========================
// HELPERS
// =========================
function normalizeBoolean(value) {
  if (value === true || value === "true" || value === "yes") return true;
  if (value === false || value === "false" || value === "no") return false;
  return null;
}

// =========================
// VALIDATION
// =========================
export function validateProtocol(protocol) {
  if (!protocol) {
    throw new Error("Protocol missing");
  }

  // =========================
  // SOFT VALIDATION (no blocking)
  // =========================

  if (protocol.event_name && !VALID_EVENTS.includes(protocol.event_name)) {
    console.warn(`⚠️ Invalid event_name: ${protocol.event_name}`);
  }

  if (protocol.user && !VALID_USERS.includes(protocol.user)) {
    console.warn(`⚠️ Invalid user: ${protocol.user}`);
  }

  if (
    protocol.quality_of_contact &&
    !VALID_QUALITY.includes(protocol.quality_of_contact)
  ) {
    console.warn(`⚠️ Invalid quality_of_contact: ${protocol.quality_of_contact}`);
  }

  if (protocol.discussed_topics) {
    if (!Array.isArray(protocol.discussed_topics)) {
      console.warn("⚠️ discussed_topics must be array");
    } else {
      for (const topic of protocol.discussed_topics) {
        if (!VALID_TOPICS.includes(topic)) {
          console.warn(`⚠️ Invalid topic: ${topic}`);
        }
      }
    }
  }

  if (protocol.business_line) {
    if (!Array.isArray(protocol.business_line)) {
      console.warn("⚠️ business_line must be array");
    } else {
      for (const line of protocol.business_line) {
        if (!VALID_BUSINESS_LINES.includes(line)) {
          console.warn(`⚠️ Invalid business line: ${line}`);
        }
      }
    }
  }

  // =========================
  // NORMALIZE BOOLEAN VALUES
  // =========================
  protocol.pre_scheduled_meeting = normalizeBoolean(
    protocol.pre_scheduled_meeting
  );

  protocol.followup_meeting = normalizeBoolean(
    protocol.followup_meeting
  );

  return protocol;
}
