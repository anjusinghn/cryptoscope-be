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
