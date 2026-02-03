const fs = require('fs');
const path = require('path');
const log = require('./logger');

const hasGlobalFetch = typeof fetch === 'function';

function resolveLocalModelPath() {
  const explicit = process.env.EMBEDDING_MODEL_PATH;
  if (explicit) {
    const abs = path.resolve(explicit);
    if (fs.existsSync(abs)) return abs;
    log.warn('embedding model path missing', { path: abs });
  }
  const bundled = path.resolve('models', 'e5-small-v2');
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

let embedderPromise = null;
let embedderAvailable = null;

function resolveRemoteModel() {
