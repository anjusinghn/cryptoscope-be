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
  if (Array.isArray(value)) return value.map((v) => Number(v) || 0);
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => Number(v) || 0) : null;
  } catch (err) {
    return null;
  }
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] || 0) * (b[i] || 0);
  return sum;
}

function magnitude(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += (vec[i] || 0) ** 2;
  return Math.sqrt(sum);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return -1;
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return -1;
  return dot(a, b) / (magA * magB);
}

function makeFileId(versionId, filePath) {
  return `${versionId}::${encodeURIComponent(filePath)}`;
}

function makeChunkId(fileId, index) {
  return `${fileId}::chunk::${index}`;
}

function makeFindingId(fileId, index) {
  return `${fileId}::finding::${index}`;
}

async function readScanPayload(versionId) {
