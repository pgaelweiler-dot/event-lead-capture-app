// =========================
// services/protocolStore.js (NEW - SIMPLE STORAGE)
// =========================
import fs from "fs";

const FILE_PATH = "./data/protocols.json";

function readStore() {
  try {
    const raw = fs.readFileSync(FILE_PATH);
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeStore(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

export function saveProtocol(record) {
  const store = readStore();

  const existingIndex = store.findIndex(p => p.protocolId === record.protocolId);

  if (existingIndex >= 0) {
    store[existingIndex] = { ...store[existingIndex], ...record };
  } else {
    store.push(record);
  }

  writeStore(store);
}
