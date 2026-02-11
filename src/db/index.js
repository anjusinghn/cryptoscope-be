const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');
const { upsertChunks } = require('./lance');

const dataRoot = process.env.CRYPTOSCOPE_DATA_DIR
  ? path.resolve(process.env.CRYPTOSCOPE_DATA_DIR)
  : path.resolve('data');
const scansDir = path.join(dataRoot, 'scans');

let initPromise = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = fs.promises
      .mkdir(scansDir, { recursive: true })
      .then(() => {
        log.info('filesystem datastore ready', { scansDir });
        return scansDir;
      })
      .catch((err) => {
        log.error('failed to prepare datastore', { error: String(err?.message || err) });
        throw err;
      });
  }
  return initPromise;
}

function scanFilePath(versionId) {
  return path.join(scansDir, `${encodeURIComponent(versionId)}.json`);
}

function toVectorLiteral(values) {
  if (!Array.isArray(values)) return null;
  const nums = values.map((v) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    return n;
  });
  return '[' + nums.join(',') + ']';
}

function parseVectorLiteral(value) {
