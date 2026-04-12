// =========================
// protocolStore.js (FINAL)
// =========================
import fs from "fs";

const BASE_PATH = "./data/protocols";
const ARCHIVE_PATH = "./data/archive";

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
    return JSON.parse(fs.readFileSync(path));
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
    console.warn("⚠️ Missing event → skipping");
    return;
  }

  if (!record?.contactId) {
    console.warn("⚠️ Missing contactId → protocol invalid");
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

  const now = new Date().toISOString();

  const enrichedRecord = {
    ...record,

    // ✅ enforce relationship
    contactId: record.contactId,
    touchpointId: record.touchpointId || null,

    // ✅ timestamps
    createdAt: record.createdAt || now,
    updatedAt: now,

    // ✅ store full extracted contact snapshot
    contact: record.payload?.extracted || {}
  };

  if (index >= 0) {
    fileData.records[index] = {
      ...fileData.records[index],
      ...enrichedRecord
    };
  } else {
    fileData.records.push(enrichedRecord);
  }

  writeFile(filePath, fileData);
}

// =========================
// ARCHIVE
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
// GET DATA
// =========================
export function getEventProtocols(event) {
  const filePath = getFilePath(event);
  return readFile(filePath);
}
