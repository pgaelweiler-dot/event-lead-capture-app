// =========================
// services/protocolMapper.js (FINAL FIXED VERSION)
// =========================
import { HARDCODED_TOUCHPOINT_FIELDS } from "./protocolConfig.js";

const PROTOCOL_TO_HUBSPOT_MAPPING = {
  event_name: { property: "n4f_touchpoint_name_dd", type: "single" },
  user: { property: "n4f_tp_event_onsite_4flower", type: "single" },
  quality_of_contact: { property: "n4f_event_quality_of_contact", type: "single" },
  pre_scheduled_meeting: { property: "n4f_tp_event_preschedulded_meeting", type: "boolean" },
  discussed_topics: { property: "n4f_event_discussed_topics_dd", type: "multi" },
  what_was_discussed: { property: "n4f_event_what_was_discussed", type: "text" },
  additional_comments: { property: "n4f_event_additonal_comments", type: "text" },
  business_line: { property: "n4f_business_line", type: "multi" },
  followup_meeting: { property: "n4f_tp_event_followup_meeting", type: "boolean" }
};

function formatValue(value, type) {
  if (value === undefined || value === null) return undefined;

  switch (type) {
    case "multi":
      return Array.isArray(value) ? value.join(";") : value;

    case "boolean":
      if (value === true) return "yes";
      if (value === false) return "no";
      return undefined;

    default:
      return value;
  }
}

export function mapProtocolToHubSpot(protocol) {
  const properties = {};

  for (const key in PROTOCOL_TO_HUBSPOT_MAPPING) {
    const config = PROTOCOL_TO_HUBSPOT_MAPPING[key];
    const rawValue = protocol[key];

    const formattedValue = formatValue(rawValue, config.type);

    if (formattedValue !== undefined) {
      properties[config.property] = formattedValue;
    }
  }

  // =========================
  // 🔥 REQUIRED FIELD FIX
  // =========================
  const touchpointName =
    protocol.event_name ||
    properties.n4f_touchpoint_name_dd ||
    "Event Touchpoint";

  // REQUIRED by HubSpot
  properties.download_name = touchpointName;

  // keep your existing field aligned
  properties.n4f_touchpoint_name_dd = touchpointName;

  // =========================
  // OPTIONAL: PROTOCOL ID
  // =========================
  if (protocol.protocolId) {
    properties.n4f_protocol_id = protocol.protocolId;
  }

  // =========================
  // DEBUG LOG (TEMP - HIGHLY RECOMMENDED)
  // =========================
  console.log("🟢 Final HubSpot properties:", properties);

  return {
    ...HARDCODED_TOUCHPOINT_FIELDS,
    ...properties
  };
}
