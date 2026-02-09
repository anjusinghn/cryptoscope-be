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
  return process.env.EMBEDDING_MODEL || 'Xenova/e5-small-v2';
}

function isLfsPointer(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (stat.size > 1024) return false; 
    const head = fs.readFileSync(filePath, 'utf8');
    return /git-lfs\.github\.com\/spec\/v1/.test(head);
  } catch {
    return false;
  }
}

function detectLocalQuantized(localDir) {
  const q = path.join(localDir, 'onnx', 'model_quantized.onnx');
  if (fs.existsSync(q) && !isLfsPointer(q)) return true;
  // Accept common alternative quantized filename
  const altQ = path.join(localDir, 'onnx', 'model_qint8_avx512_vnni.onnx');
  if (fs.existsSync(altQ) && !isLfsPointer(altQ)) return true;
  return false;
