const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const extract = require('extract-zip');
const log = require('../utils/logger');
const { cors, corsOptions, ALLOWED_ORIGINS, DEFAULT_CONCURRENCY, INDEXING_DISABLED } = require('../config');
const { getCachedScan, scanWorkspace } = require('../service/pipeline');
const { buildAnalysisResult } = require('../service/analysis');
const { collectWorkspaceFiles } = require('../lib/filesystem');
const { enrichFindingsForVersion } = require('../llm/enrich');
const { runWorkspaceScan } = require('../service/scan');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.ZIP_MAX_BYTES || 80 * 1024 * 1024),
  },
});

router.post('/api/upload-zip', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Missing file upload.' });
  }
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cryptoscope-zip-'));
  const zipPath = path.join(tempDir, 'upload.zip');
  try {
    await fs.promises.writeFile(zipPath, req.file.buffer);
    const extractDir = path.join(tempDir, 'extract');
    await fs.promises.mkdir(extractDir, { recursive: true });
    await extract(zipPath, { dir: extractDir });

    const cacheKey = `zip:${hash}`;
    if (!req.body?.force) {
      const cached = await getCachedScan(cacheKey);
      if (cached) {
        const response = buildAnalysisResult(cached);
        response.status = 'cached';
        return res.json(response);
      }
    }

    const files = await collectWorkspaceFiles(extractDir);
    if (!files.length) {
      return res.json({
        status: 'ok',
        total_files: 0,
        crypto_files_found: 0,
        message: 'Archive uploaded but no supported source files were found.',
        basic_analysis: [],
        detailed_reviews: [],
      });
    }

    const scan = await runWorkspaceScan({
      files: files.map((file) => ({ path: file.path, content: file.content })),
      versionId: cacheKey,
      sourceType: 'zip',
      sourceLocator: `zip:${hash.slice(0, 8)}`,
      meta: { zipHash: hash },
      concurrency: req.body?.concurrency,
    });

    enrichFindingsForVersion(cacheKey).catch((err) => {
      log.warn('enrich (zip) failed', { error: String(err?.message || err) });
    });

    const response = buildAnalysisResult(scan);
    response.versionId = cacheKey;
    return res.json(response);
  } catch (err) {
    log.error('api/upload-zip error', { error: String(err?.message || err) });
    return res.status(500).json({ error: 'Failed to process archive.' });
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
});

// SSE endpoint for ZIP upload with real-time progress
router.options('/api/upload-zip-sse', cors(corsOptions));
router.post('/api/upload-zip-sse', cors(corsOptions), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Missing file upload.' });
  }

  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cryptoscope-zip-'));
  const zipPath = path.join(tempDir, 'upload.zip');

  try {
    // Set up SSE
    res.status(200);
    const origin = String(req.headers.origin || '');
    const isAllowed = origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin));
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Last-Event-ID');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Last-Event-ID');
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    log.info('sse connection open', { endpoint: 'upload-zip-sse', hash: hash.slice(0, 8) });

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush(); // Explicitly flush to ensure immediate delivery
    };

    let cancelled = false;
    // Disable timeouts and enable keepalive on the socket for long-running uploads/scans
    try { req.setTimeout?.(0); } catch {}
    try { res.setTimeout?.(0); } catch {}
    try { req.socket?.setTimeout?.(0); } catch {}
    try { req.socket?.setKeepAlive?.(true); } catch {}
    try { req.socket?.setNoDelay?.(true); } catch {}

    // Heartbeat ping every 15s to keep intermediaries from closing idle connections
    let heartbeat = setInterval(() => {
      try {
        res.write(`event: ping\n`);
        res.write(`data: {"t":${Date.now()}}\n\n`);
        if (res.flush) res.flush();
      } catch {}
    }, 15000);

    req.on('close', () => { cancelled = true; try { clearInterval(heartbeat); } catch {}; heartbeat = null; });

    send('extracting', { message: 'Extracting archive...' });
    await fs.promises.writeFile(zipPath, req.file.buffer);
    const extractDir = path.join(tempDir, 'extract');
    await fs.promises.mkdir(extractDir, { recursive: true });
    await extract(zipPath, { dir: extractDir });

    const cacheKey = `zip:${hash}`;
    if (!req.body?.force) {
      const cached = await getCachedScan(cacheKey);
      if (cached) {
        const response = buildAnalysisResult(cached);
        response.status = 'cached';
        response.versionId = cacheKey;
        send('cached', response);
        return res.end();
      }
    }

    send('collecting', { message: 'Collecting files...' });
    const files = await collectWorkspaceFiles(extractDir);
    send('start', { total: files.length });

    if (!files.length) {
      const emptyResult = {
        status: 'ok',
        total_files: 0,
        crypto_files_found: 0,
        message: 'Archive uploaded but no supported source files were found.',
        basic_analysis: [],
        detailed_reviews: [],
      };
      send('done', emptyResult);
      return res.end();
    }

    const scan = await scanWorkspace({
      files: files.map((file) => ({ path: file.path, content: file.content })),
      versionId: cacheKey,
      sourceType: 'zip',
      sourceLocator: `zip:${hash.slice(0, 8)}`,
      meta: { zipHash: hash },
      concurrency: Number.isFinite(req.body?.concurrency) && req.body?.concurrency > 0 ? req.body.concurrency : DEFAULT_CONCURRENCY,
      skipIndexing: INDEXING_DISABLED,
      onFile: async ({ file, error }) => {
        if (cancelled) return;
        if (error) {
          send('error', { message: `Error scanning file: ${file?.path}` });
        } else if (file && !INDEXING_DISABLED) {
          send('indexing', { message: `Indexing file: ${file.path}` });
        }
      },
      onProgress: async ({ done, total }) => {
        if (!cancelled) send('scanning', { message: `Scanning files...`, done, total });
      },
    });

    send('enriching', { message: 'Enriching findings...' });
    enrichFindingsForVersion(cacheKey).catch((err) => {
      log.warn('enrich (zip-sse) failed', { versionId: cacheKey, error: String(err?.message || err) });
    });

    if (!cancelled) {
      const response = buildAnalysisResult(scan);
      response.versionId = cacheKey;
      send('done', response);
      // Small delay before closing to ensure event is received
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (err) {
    log.error('api/upload-zip-sse error', { error: String(err?.message || err) });
    try {
      send('error', { message: 'Failed to process archive.' });
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {}
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
    try { if (heartbeat) clearInterval(heartbeat); } catch {}
    res.end();
  }
});

module.exports = router;
