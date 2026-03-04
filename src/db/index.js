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
  await ensureInitialized();
  const filePath = scanFilePath(versionId);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeScanPayload(versionId, payload) {
  await ensureInitialized();
  const filePath = scanFilePath(versionId);
  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2));
}

async function initDb() {
  await ensureInitialized();
}

function normalizeEmbedding(vec) {
  if (!Array.isArray(vec)) return [];
  return vec.map((v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  });
}

async function storeScanResult(scan) {
  const {
    versionId,
    sourceType,
    sourceLocator,
    summary = {},
    meta = {},
    files = [],
  } = scan || {};
  if (!versionId) throw new Error('storeScanResult requires versionId');

  const now = new Date().toISOString();
  const existing = await readScanPayload(versionId);
  const createdAt = existing?.version?.created_at || now;

  const preparedFiles = [];
  const lanceDocs = [];
  for (const file of files) {
    const filePath = typeof file.path === 'string' ? file.path : 'unknown';
    const fileId = makeFileId(versionId, filePath);
    const chunks = [];
    if (Array.isArray(file.chunks)) {
      for (const chunk of file.chunks) {
        const index = typeof chunk.index === 'number' ? chunk.index : chunks.length;
        const chunkId = makeChunkId(fileId, index);
        const embedding = normalizeEmbedding(chunk.embedding);
        chunks.push({
          id: chunkId,
          chunkIndex: index,
          label: chunk.label || null,
          startLine: typeof chunk.startLine === 'number' ? chunk.startLine : null,
          endLine: typeof chunk.endLine === 'number' ? chunk.endLine : null,
          content: chunk.content || null,
          embedding,
        });
        if (embedding.length) {
          lanceDocs.push({
            filePath,
            chunkIndex: index,
            startLine: typeof chunk.startLine === 'number' ? chunk.startLine : null,
            endLine: typeof chunk.endLine === 'number' ? chunk.endLine : null,
            label: chunk.label || null,
            content: chunk.content || null,
            embedding,
          });
        }
      }
    }

    const chunkRanges = chunks.map((chunk) => ({
      id: chunk.id,
      start: typeof chunk.startLine === 'number' ? chunk.startLine : null,
      end: typeof chunk.endLine === 'number' ? chunk.endLine : null,
    }));

    const findings = [];
