// services/protocolValidator.js

import {
  VALID_QUALITY,
  VALID_TOPICS,
  VALID_BUSINESS_LINES,
  VALID_USERS
} from "./protocolConfig.js";

// ==============================
// HELPERS
// ==============================

function normalizeBoolean(value) {
  if (value === true || value === "true" || value === "yes") return true;
  if (value === false || value === "false" || value === "no") return false;
  return null;
}

// ==============================
// VALIDATION
// ==============================

export function validateProtocol(protocol) {
  if (!protocol) {
    throw new Error("Protocol missing");
  }

  if (protocol.user && !VALID_USERS.includes(protocol.user)) {
    throw new Error(`Invalid user: ${protocol.user}`);
  }

  if (
    protocol.quality_of_contact &&
    !VALID_QUALITY.includes(protocol.quality_of_contact)
  ) {
    throw new Error(`Invalid quality_of_contact: ${protocol.quality_of_contact}`);
  }

  if (protocol.discussed_topics) {
    if (!Array.isArray(protocol.discussed_topics)) {
      throw new Error("discussed_topics must be array");
    }

    for (const topic of protocol.discussed_topics) {
      if (!VALID_TOPICS.includes(topic)) {
        throw new Error(`Invalid topic: ${topic}`);
      }
    }
  }

  if (protocol.business_line) {
    if (!Array.isArray(protocol.business_line)) {
      throw new Error("business_line must be array");
    }

    for (const line of protocol.business_line) {
      if (!VALID_BUSINESS_LINES.includes(line)) {
        throw new Error(`Invalid business line: ${line}`);
      }
    }
  }

  protocol.pre_scheduled_meeting = normalizeBoolean(
    protocol.pre_scheduled_meeting
  );

  protocol.followup_meeting = normalizeBoolean(
    protocol.followup_meeting
  );

  return protocol;
}
