import { useState } from "react";
import Tesseract from "tesseract.js";

/* =========================================================
   🧠 HELPERS
   - keep display text as-is (umlauts preserved)
   - use separate normalization for MATCHING
========================================================= */
function normalize(text) {
  return text
    ?.toLowerCase()
    .replace(/[^a-z0-9äöüß ]/g, "")
    .trim();
}

function normalizeForMatch(text) {
  return text
    ?.toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function capitalizeWords(text) {
  return text
    ?.toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function capitalizeJobTitle(text) {
  if (!text) return "";
  const words = text.toLowerCase().split(" ");
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

/* =========================================================
   📧 EMAIL + DOMAIN
========================================================= */
function extractDomain(email, website, company) {
  if (email?.includes("@")) return email.split("@")[1];
  if (website) return website.replace(/https?:\/\//, "").replace("www.", "");
  return normalizeForMatch(company) + ".com";
}

function generateEmails(first, last, domain) {
  const f = normalizeForMatch(first);
  const l = normalizeForMatch(last);
  const fi = f ? f[0] : "";

  return [
    `${f}.${l}@${domain}`,
    `${f}${l}@${domain}`,
    `${fi}${l}@${domain}`,
    `${fi}.${l}@${domain}`
  ].filter(Boolean);
}

/* =========================================================
   🔍 MATCHING (robust to OCR + umlauts)
========================================================= */
function similarity(a, b) {
  a = normalizeForMatch(a);
  b = normalizeForMatch(b);

  if (!a || !b) return 0;
  if (a === b) return 1;

  // allow partial overlap (helps OCR drift)
  if (a.includes(b) || b.includes(a)) return 0.8;

  let matches = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) matches++;
  }

  return matches / Math.max(a.length, b.length);
}

function findContact(db, first, last, company) {
  let best = null;
  let bestScore = 0;

  db.forEach((c) => {
    const score = similarity(first, c.first) + similarity(last, c.last);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });

  // slightly lower threshold to tolerate OCR noise
  return bestScore > 0.9 ? best : null;
}

/* =========================================================
   🧠 OCR PARSER (layout-aware, NOT fixed order)
   Strategy:
   - score lines (not strict positions)
   - combine signals: tokens, symbols, keywords, length
========================================================= */
const TITLE_KEYWORDS = [
  "manager","director","lead","head","marketing","sales","engineer","consultant","specialist"
];

function preprocessOCR(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean);
}

function extractEmail(lines) {
  const regex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  for (const l of lines) {
    const m = l.match(regex);
    if (m) return m[0];
  }
  return "";
}

function extractWebsite(lines) {
  const regex = /(www\.[^\s]+)|(https?:\/\/[^\s]+)/i;
  for (const l of lines) {
    const m = l.match(regex);
    if (m) return m[0];
  }
  return "";
}

// 🔥 NAME: score-based, favors person-like tokens, not rigid position
function extractName(lines) {
  let best = "";
  let bestScore = 0;

  lines.forEach((l, idx) => {
    const words = l.split(" ").filter(Boolean);
    let score = 0;

    // word structure
    if (words.length === 2) score += 4;
    if (words.length === 3) score += 2;

    // looks like a name (capitalized words)
    if (words.every(w => w[0] === w[0]?.toUpperCase())) score += 2;

    // avoid obvious non-name lines
    if (/\d|@/.test(l)) score -= 2;
    if (l.includes("|") || l.includes("http")) score -= 1;

    // mild preference for upper part (but not strict)
    score += Math.max(0, 3 - idx * 0.5);

    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  });

  const parts = best.split(" ").filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts[1] || "",
    confidence: bestScore >= 6 ? "high" : bestScore >= 4 ? "medium" : "low"
  };
}

// 🔥 JOB TITLE: looks for strong separators and keywords
function extractJobTitle(lines) {
  let best = "";
  let bestScore = 0;

  lines.forEach((l) => {
    let score = 0;

    if (TITLE_KEYWORDS.some(k => l.toLowerCase().includes(k))) score += 3;
    if (l.includes("|") || l.includes("&")) score += 2; // common in titles

    // avoid emails/urls
    if (/@|http/.test(l)) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  });

  return {
    value: best,
    confidence: bestScore >= 3 ? "high" : bestScore >= 2 ? "medium" : "low"
  };
}

// 🔥 COMPANY: prefer domain signals, otherwise score lines
function extractCompany(lines, email, website) {
  if (email) {
    return { value: email.split("@")[1].split(".")[0], confidence: "high" };
  }

  if (website) {
    return {
      value: website.replace(/https?:\/\//, "").replace("www.", "").split(".")[0],
      confidence: "high"
    };
  }

  let best = "";
  let bestScore = 0;

  lines.forEach((l) => {
    let score = 0;

    if (l.length < 40) score += 1;
    if (!/\d/.test(l)) score += 1;
    if (!/@|http/.test(l)) score += 1;

    // company-like tokens
    if (/(gmbh|se|ag|ltd|inc)/i.test(l)) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  });

  return { value: best, confidence: bestScore >= 3 ? "medium" : "low" };
}

function parseOCR(text) {
  const lines = preprocessOCR(text);

  const email = extractEmail(lines);
  const website = extractWebsite(lines);

  const name = extractName(lines);
  const job = extractJobTitle(lines);
  const company = extractCompany(lines, email, website);

  return {
    firstName: name.firstName,
    lastName: name.lastName,
    jobTitle: job.value,
    company: company.value,
    email,
    website,
    fieldConfidence: {
      name: name.confidence,
      jobTitle: job.confidence,
      company: company.confidence
    }
  };
}

/* =========================================================
   🚀 APP
========================================================= */
export default function App() {

  console.log("App start"); // 1

  const [contactsDB, setContactsDB] = useState([]);
  console.log("State 1"); // 2

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  console.log("State 2"); // 3

  const [emails, setEmails] = useState([]);
  const [matchedContact, setMatchedContact] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [fieldConfidence, setFieldConfidence] = useState({});
  console.log("State 3"); // 4

  const [step, setStep] = useState("capture");
  const [protocol, setProtocol] = useState({
    quality_of_contact: "",
    discussed_topics: [],
    relevant_business_lines: [],
    preferred_language: "",
    phone_number: "",
    pre_scheduled_meeting: ""
  });

  console.log("Before functions"); // 5

useEffect(() => {
  if (!firstName || !lastName) {
    setMatchedContact(null);
    return;
  }

  if (firstName.length < 2 || lastName.length < 2) {
    setMatchedContact(null);
    return;
  }

  const match = findContact(
    contactsDB,
    firstName,
    lastName,
    company
  );

  setMatchedContact(match);
  
}, [firstName, lastName, company, contactsDB]);


  function handleCSVUpload(e) {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = function (event) {
      const text = event.target.result.trim();
      const delimiter = text.includes(";") ? ";" : ",";

      const lines = text.split("\n");
      const header = lines[0].split(delimiter).map(h => h.toLowerCase());

      const data = lines.slice(1).map(line => {
        const cols = line.split(delimiter);
        return {
          id: cols[header.indexOf("id")] || "",
          first: cols[header.indexOf("firstname")] || "",
          last: cols[header.indexOf("lastname")] || "",
          email: cols[header.indexOf("email")] || "",
          company: cols[header.indexOf("company")] || "",
          title: cols[header.indexOf("title")] || "",
          bounce: cols[header.indexOf("bounce")] || "false"
        };
      });

      setContactsDB(data);
      alert("Contacts loaded");
    };

    reader.readAsText(file);
  }

  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setOcrLoading(true);

    Tesseract.recognize(file, "eng")
      .then(({ data: { text } }) => {
        const parsed = parseOCR(text);

        setFirstName(capitalizeWords(parsed.firstName));
        setLastName(capitalizeWords(parsed.lastName));
        setJobTitle(capitalizeJobTitle(parsed.jobTitle));
        setCompany(capitalizeWords(parsed.company));

        if (parsed.email) setEmail(parsed.email);

        setFieldConfidence(parsed.fieldConfidence);

        const existing = findContact(
          contactsDB,
          parsed.firstName,
          parsed.lastName,
          parsed.company
        );

        setOcrLoading(false);
      })
      .catch(() => setOcrLoading(false));
  }

  function handleGenerate() {
    const domain = extractDomain(email, "", company);
    setEmails(generateEmails(firstName, lastName, domain));
  }

  function handleSave() {
    // 🔥 instead of saving immediately → go to protocol
    setStep("protocol");
    return;
    if (!email) return alert("Enter email");

    let updated = [...contactsDB];

    if (matchedContact?.id) {
      updated = updated.map(c =>
        c.id === matchedContact.id
          ? { ...c, email, company, title: jobTitle }
          : c
      );
    } else {
      updated.push({ first: firstName, last: lastName, email, company, title: jobTitle });
    }

    setContactsDB(updated);
    alert("Saved");
  }

  function handleNewScan() {
    setFirstName("");
    setLastName("");
    setCompany("");
    setJobTitle("");
    setEmail("");
    setEmails([]);
    setMatchedContact(null);
    setFieldConfidence({});
  }

  if (step === "protocol") {
    const continueFlow = [
      "Sales potential",
      "Sales potential unclear",
      "Contact maintenance",
      "Partner"
    ].includes(protocol.quality_of_contact);
  
    return (
      <div className="protocol">
        <h3>Booth Protocol</h3>
  
        <label>Quality of contact</label>
  
        {[
          "Sales potential",
          "Sales potential unclear",
          "Contact maintenance",
          "Vendor",
          "Competitor",
          "Other",
          "Partner"
        ].map(opt => (
          <div key={opt}>
            <input
              type="radio"
              checked={protocol.quality_of_contact === opt}
              onChange={() =>
                setProtocol({ ...protocol, quality_of_contact: opt })
              }
            />
            {opt}
          </div>
        ))}
  
        {protocol.quality_of_contact && continueFlow && (
          <div>
            <h4>Details</h4>
  
            <label>Preferred Language</label>
            <select
              value={protocol.preferred_language}
              onChange={(e) =>
                setProtocol({
                  ...protocol,
                  preferred_language: e.target.value
                })
              }
            >
              <option value="">Select</option>
              <option>English</option>
              <option>German</option>
            </select>
          </div>
        )}
  
        <button onClick={() => setStep("capture")}>Back</button>
  
        <button
          onClick={() => {
            alert("Saved with protocol");
            setStep("capture");
          }}
        >
          Done
        </button>
      </div>
    );
  }



  return (
    <div>
      <h2>Event Lead Capture</h2>

      <input type="file" onChange={handleCSVUpload} />
      <input type="file" onChange={handleImageUpload} />

      {ocrLoading && <div>Scanning...</div>}

      <div className="form">
        <input className={fieldConfidence.name || ""} value={firstName} onChange={e => setFirstName(capitalizeWords(e.target.value))} placeholder="First Name" />
        <input className={fieldConfidence.name || ""} value={lastName} onChange={e => setLastName(capitalizeWords(e.target.value))} placeholder="Last Name" />
        <input className={fieldConfidence.company || ""} value={company} onChange={e => setCompany(capitalizeWords(e.target.value))} placeholder="Company" />
        <input className={fieldConfidence.jobTitle || ""} value={jobTitle} onChange={e => setJobTitle(capitalizeJobTitle(e.target.value))} placeholder="Job Title" />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />

        <div className="actions">
          <button onClick={handleGenerate}>Check email</button>
          <button onClick={handleSave}>Save</button>
        </div>

        <button onClick={handleNewScan}>New Scan</button>
      </div>

      {matchedContact && (
        <div className={`match-box ${matchedContact.bounce === "true" ? "bounce" : ""}`}>
          <div className="match-header">Existing Contact</div>
          <div className="match-name">{matchedContact.first} {matchedContact.last}</div>
          {matchedContact.title && <div className="match-title">{matchedContact.title}</div>}
          {matchedContact.email && <div className="match-email">{matchedContact.email}</div>}

          <button className="primary" onClick={() => {
            setEmail(matchedContact.email || "");
            setJobTitle(matchedContact.title || "");
          }}>
            Use Existing Contact
          </button>

          {matchedContact.bounce === "true" && (
            <div className="bounce-warning">⚠ Email bounced</div>
          )}
        </div>
      )}

      {emails.map((e, i) => (
        <div key={i} className="email-item">
          <span className="email-text">{e}</span>
          <button className="email-use" onClick={() => setEmail(e)}>Use</button>
        </div>
      ))}
    </div>
  );
}
