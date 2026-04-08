// =========================
// services/protocolStore.js (EVENT-BASED STORAGE + ARCHIVE)
// =========================
import fs from "fs";

const BASE_PATH = "./data/protocols";
const ARCHIVE_PATH = "./data/archive";

// =========================
// HELPERS
// =========================
function ensureDir(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

function getFilePath(event) {
  const safeEvent = event.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return `${BASE_PATH}/${safeEvent}.json`;
}

function readFile(path) {
  try {
    const raw = fs.readFileSync(path);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// =========================
// SAVE / UPSERT PROTOCOL
// =========================
export function saveProtocol(record) {
  if (!record?.payload?.meta?.event) {
    console.warn("⚠️ Missing event in payload → skipping storage");
    return;
  }

  ensureDir(BASE_PATH);

  const event = record.payload.meta.event;
  const filePath = getFilePath(event);

  let fileData = readFile(filePath);

  if (!fileData) {
    fileData = {
      event,
      createdAt: new Date().toISOString(),
      records: []
    };
  }

  const index = fileData.records.findIndex(
    r => r.protocolId === record.protocolId
  );

  if (index >= 0) {
    fileData.records[index] = {
      ...fileData.records[index],
      ...record
    };
  } else {
    fileData.records.push(record);
  }

  writeFile(filePath, fileData);
}

// =========================
// ARCHIVE EVENT
// =========================
export function archiveEvent(event) {
  ensureDir(BASE_PATH);
  ensureDir(ARCHIVE_PATH);

  const source = getFilePath(event);
  const safeEvent = event.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const target = `${ARCHIVE_PATH}/${safeEvent}.json`;

  if (!fs.existsSync(source)) {
    throw new Error("Event file not found");
  }

  fs.renameSync(source, target);

  return {
    success: true,
    archivedTo: target
  };
}

// =========================
// OPTIONAL: GET EVENT DATA
// =========================
export function getEventProtocols(event) {
  const filePath = getFilePath(event);
  return readFile(filePath);
}


// =========================
// ADD THIS TO server.js
// =========================

// import { archiveEvent, getEventProtocols } from "./services/protocolStore.js";

// =========================
// ARCHIVE ENDPOINT
// =========================

// app.post("/admin/archive-event", (req, res) => {
//   try {
//     const { event } = req.body;
//     const result = archiveEvent(event);
//     res.json(result);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// =========================
// FETCH EVENT DATA (DEBUG)
// =========================

// app.get("/admin/event/:event", (req, res) => {
//   try {
//     const data = getEventProtocols(req.params.event);
//     res.json(data || { records: [] });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });


// =========================
// RESULT
// =========================
// ✔ Storage split by event
// ✔ Safe file handling
// ✔ Archive support
// ✔ Update-safe (protocolId)
// ✔ Ready for DB migration later
