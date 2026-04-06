// services/protocolConfig.js

// ==============================
// HARDCODED FIELDS
// ==============================

const HARDCODED_TOUCHPOINT_FIELDS = {
  n4f_touchpoint_type: "Event booth Meeting",
  n4f_activity_status: "Booth discussion"
};

// ==============================
// VALID ENUMS (STRICT CONTROL)
// ==============================

const VALID_QUALITY = [
  "Sales potential",
  "Sales potential unclear",
  "Contact maintenance",
  "Vendor",
  "Competitor",
  "Other",
  "Partner"
];

const VALID_TOPICS = [
  "SAP Digital Supply Chain",
  "4flow software solutions",
  "Warehousing and intralogistics",
  "General interest in 4flow",
  "tbd"
];

const VALID_BUSINESS_LINES = [
  "4fc",
  "4fm",
  "4fs",
  "4fc-SAP",
  "4fc-Kinaxis",
  "4flow"
];

// ⚠️ IMPORTANT: Replace if needed later with ID mapping
const VALID_USERS = [
  "Alexander Deger",
  "Andreas Weber",
  "Christian Lieberoth-Leden",
  "Christian Schomann",
  "Jan-Hendrik Kölling",
  "Jan-Moritz Metelmann",
  "Jan-Niklas Grafe",
  "Joachim Wittmack",
  "Katharina von Helldorff-Mager",
    // 👉 Add more if needed
];

// ==============================
// EXPORT
// ==============================

module.exports = {
  HARDCODED_TOUCHPOINT_FIELDS,
  VALID_QUALITY,
  VALID_TOPICS,
  VALID_BUSINESS_LINES,
  VALID_USERS
};
