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
