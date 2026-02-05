const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');

let lanceClientPromise = null;
let tablePromise = null;

async function getLanceLib() {
  if (!lanceClientPromise) {
    lanceClientPromise = import('@lancedb/lancedb').catch((err) => {
      log.warn('lancedb not available', { error: String(err?.message || err) });
      return null;
    });
  }
  return lanceClientPromise;
}

function resolveDbDir() {
  const configured = process.env.LANCEDB_DIR ? path.resolve(process.env.LANCEDB_DIR) : null;
  if (configured) {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
