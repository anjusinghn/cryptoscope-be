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
  }
  const defaultDir = path.resolve('lancedb');
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

async function getDb() {
  const lib = await getLanceLib();
  if (!lib || !lib.connect) return null;
  const { connect } = lib;
  const dir = resolveDbDir();
  const db = await connect(dir);
  return db;
}

async function ensureTable() {
  if (!tablePromise) {
    tablePromise = (async () => {
      try {
        const lib = await getLanceLib();
        if (!lib) return null;
        const db = await getDb();
        if (!db) return null;
        try {
          const table = await db.openTable('code_chunks');
          return table;
        } catch (err) {
          // Attempt to create the table without manual Arrow schema (let engine infer later on first add)
          try {
            log.info('lancedb creating code_chunks table', { message: err?.message });
            await db.createTable('code_chunks', []);
            return await db.openTable('code_chunks');
          } catch (e) {
            log.warn('lancedb table create failed; disabling LanceDB usage', { error: String(e?.message || e) });
            return null;
          }
        }
      } catch (outer) {
        log.warn('lancedb ensureTable failed', { error: String(outer?.message || outer) });
        return null;
      }
    })();
  }
  return tablePromise;
}

function normalizeEmbedding(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return null;
  const arr = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const v = Number(vec[i]);
    arr[i] = Number.isFinite(v) ? v : 0;
  }
  return Array.from(arr);
}

async function upsertChunks(versionId, chunks) {
  if (!versionId || !Array.isArray(chunks) || chunks.length === 0) return;
  const table = await ensureTable();
  if (!table) return;
  try {
    await table.deleteWhere(`versionId = '${versionId.replace(/'/g, "''")}'`);
  } catch (err) {
    log.warn('lancedb deleteWhere failed', { versionId, error: err?.message });
  }
  const docs = [];
  for (const chunk of chunks) {
    const embedding = normalizeEmbedding(chunk.embedding);
    if (!embedding) continue;
    docs.push({
      id: `${versionId}:${chunk.filePath}:${chunk.chunkIndex}`,
      versionId,
      filePath: chunk.filePath,
      chunkIndex: typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : 0,
      startLine: typeof chunk.startLine === 'number' ? chunk.startLine : 0,
      endLine: typeof chunk.endLine === 'number' ? chunk.endLine : 0,
      label: chunk.label || null,
      content: chunk.content || null,
      embedding,
    });
  }
  if (docs.length === 0) return;
  await table.add(docs);
  log.info('LanceDB upsert complete', { versionId, rows: docs.length });
}

async function searchChunks(versionId, vector, limit = 5) {
  if (!versionId || !Array.isArray(vector) || vector.length === 0) return [];
  try {
    const table = await ensureTable();
    if (!table) return [];
    const norm = normalizeEmbedding(vector);
    if (!norm) return [];
    const res = await table
      .search(norm)
      .where(`versionId = '${versionId.replace(/'/g, "''")}'`)
      .limit(limit)
      .execute();
    const rows = Array.isArray(res) ? res : res.toArray?.() ? await res.toArray() : [];
    return rows;
  } catch (err) {
    log.warn('lancedb search failed', { versionId, error: err?.message });
    return [];
  }
}

module.exports = { upsertChunks, searchChunks };
