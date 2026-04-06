// services/protocolMapper.js

const { HARDCODED_TOUCHPOINT_FIELDS } = require("./protocolConfig");

// ==============================
// MAPPING CONFIG
// ==============================

const PROTOCOL_TO_HUBSPOT_MAPPING = {
  event_name: {
    property: "n4f_touchpoint_name_dd",
    type: "single"
  },

  user: {
    property: "n4f_tp_event_onsite_4flower",
    type: "single"
  },

  quality_of_contact: {
    property: "n4f_event_quality_of_contact",
    type: "single"
  },

  pre_scheduled_meeting: {
    property: "n4f_tp_event_preschedulded_meeting",
    type: "boolean"
  },

  discussed_topics: {
    property: "n4f_event_discussed_topics_dd",
    type: "multi"
  },

  what_was_discussed: {
    property: "n4f_event_what_was_discussed",
    type: "text"
  },

  additional_comments: {
    property: "n4f_event_additonal_comments",
    type: "text"
  },

  business_line: {
    property: "n4f_business_line",
    type: "multi"
  },

  followup_meeting: {
    property: "n4f_tp_event_followup_meeting",
    type: "boolean"
  }
};

// ==============================
// FORMATTER
// ==============================

function formatValue(value, type) {
  if (value === undefined || value === null) return undefined;

  switch (type) {
    case "multi":
      return Array.isArray(value) ? value.join(";") : value;

    case "boolean":
      return value === true ? "true" : "false";

    case "single":
    case "text":
    default:
      return value;
  }
}

// ==============================
// MAPPER
// ==============================

function mapProtocolToHubSpot(protocol) {
  const properties = {};

  for (const key in PROTOCOL_TO_HUBSPOT_MAPPING) {
    const config = PROTOCOL_TO_HUBSPOT_MAPPING[key];
    const rawValue = protocol[key];

    const formattedValue = formatValue(rawValue, config.type);

    if (formattedValue !== undefined) {
      properties[config.property] = formattedValue;
    }
  }

  return {
    ...HARDCODED_TOUCHPOINT_FIELDS,
    ...properties
  };
}

module.exports = {
  mapProtocolToHubSpot
};
