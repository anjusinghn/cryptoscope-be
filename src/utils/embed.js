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
}

function detectLocalOnnx(localDir) {
  const p = path.join(localDir, 'onnx', 'model.onnx');
  if (fs.existsSync(p) && !isLfsPointer(p)) return true;
  // Accept common alternative fp32 filename
  const alt = path.join(localDir, 'onnx', 'model_O4.onnx');
  if (fs.existsSync(alt) && !isLfsPointer(alt)) return true;
  // Some repos place the ONNX at the root
  const rootP = path.join(localDir, 'model.onnx');
  if (fs.existsSync(rootP) && !isLfsPointer(rootP)) return true;
  return false;
}

function ensureExpectedOnnxFilename(localDir, quantized) {
  const onnxDir = path.join(localDir, 'onnx');
  const expected = path.join(onnxDir, quantized ? 'model_quantized.onnx' : 'model.onnx');
  try {
    if (fs.existsSync(expected) && !isLfsPointer(expected)) return expected;
  } catch {}
  const candidates = [
    quantized
      ? path.join(onnxDir, 'model_qint8_avx512_vnni.onnx')
      : path.join(onnxDir, 'model_O4.onnx'),
    path.join(localDir, 'model.onnx'),
  ];
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand) && !isLfsPointer(cand)) {
        fs.mkdirSync(onnxDir, { recursive: true });
        if (!fs.existsSync(expected)) {
          fs.symlinkSync(cand, expected);
          log.info('created ONNX symlink for transformers', { from: cand, to: expected });
        }
        return expected;
      }
    } catch (e) {
      log.warn('ensureExpectedOnnxFilename error', { error: String(e?.message || e) });
    }
  }
  return null;
}

async function loadTransformersEmbedder() {
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      const localModel = resolveLocalModelPath();

      let model;
      let quantized;
      if (localModel) {
        const localRoot = path.dirname(localModel);
        env.localModelPath = localRoot + path.sep;
        env.allowRemoteModels = process.env.EMBEDDING_REMOTE === '1';
        model = path.basename(localModel); 

        if (process.env.EMBEDDING_QUANTIZED === 'true') quantized = true;
        else if (process.env.EMBEDDING_QUANTIZED === 'false') quantized = false;
        else quantized = detectLocalQuantized(localModel);

        const ensured = ensureExpectedOnnxFilename(localModel, quantized);
        if (!ensured) {
          if (quantized) {
            const qfile = path.join(localModel, 'onnx', 'model_quantized.onnx');
            log.warn('local quantized model missing or is a Git LFS pointer', { file: qfile });
          } else {
            const p = path.join(localModel, 'onnx', 'model.onnx');
            log.warn('local onnx model missing or is a Git LFS pointer', { file: p });
          }
          log.warn('embedding may fail unless you fetch real ONNX weights (git lfs pull) or allow remote downloads via EMBEDDING_REMOTE=1');
        }
      } else {
        env.allowRemoteModels = true;
        model = resolveRemoteModel();
        quantized = process.env.EMBEDDING_QUANTIZED !== 'false';
      }

      const pipe = await pipeline('feature-extraction', model, { quantized });
      embedderAvailable = 'transformers';
      log.info('loaded transformers embedder', {
        model,
        source: localModel ? 'local' : 'remote',
        quantized,
        remoteAllowed: Boolean(env.allowRemoteModels),
      });
      return pipe;
    } catch (err) {
      embedderAvailable = null;
      log.warn('failed to load transformers embedder', { error: String(err?.message || err) });
      throw err;
    }
  })();
  return embedderPromise;
}

async function embedWithHttp(texts) {
  const url = process.env.EMBEDDING_API_URL;
  if (!url || !hasGlobalFetch) return null;
  try {
    const body = { input: texts, model: resolveRemoteModel() };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    const vectors = data.map((item) => Array.isArray(item?.embedding) ? item.embedding : []);
    embedderAvailable = 'http';
    return vectors;
  } catch (err) {
    log.warn('http embedding failed', { error: String(err?.message || err) });
    return null;
  }
}

async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  if (process.env.EMBEDDING_DISABLED === '1') return texts.map(() => []);

  // Prefer explicit HTTP endpoint if configured
  if (process.env.EMBEDDING_API_URL) {
    const viaHttp = await embedWithHttp(texts);
    if (viaHttp) return viaHttp;
  }

  try {
    const pipe = await loadTransformersEmbedder();
    const vectors = [];
    for (const text of texts) {
      try {
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data ?? output);
        vectors.push(embedding);
      } catch (err) {
        log.warn('embedding invocation failed', { error: String(err?.message || err) });
        vectors.push([]);
      }
    }
    return vectors;
  } catch (err) {
    log.error('embedding failed', { error: String(err?.message || err) });
    return texts.map(() => []);
  }
}

module.exports = { embedTexts };
