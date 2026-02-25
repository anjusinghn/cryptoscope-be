const express = require('express');
const path = require('path');
const crypto = require('crypto');
const log = require('../utils/logger');
const { cors, corsOptions, ALLOWED_ORIGINS, DEFAULT_CONCURRENCY, INDEXING_DISABLED } = require('../config');
const { collectWorkspaceFiles, describeDirectory, safeStat } = require('../lib/filesystem');
const { registerWorkspace } = require('../repo/github');
const { scanWorkspace } = require('../service/pipeline');
const { runWorkspaceScan } = require('../service/scan');
const { buildAnalysisResult } = require('../service/analysis');
const { enrichFindingsForVersion } = require('../llm/enrich');

const router = express.Router();

router.post('/api/analyze', async (req, res) => {
  try {
    const { path: targetPath, concurrency } = req.body || {};
    if (!targetPath || typeof targetPath !== 'string') {
      return res.status(400).json({ error: 'Missing `path` string.' });
    }
    const absPath = path.resolve(targetPath);
    const stat = await safeStat(absPath);
    if (!stat) {
      return res.status(404).json({ error: 'Path not found.' });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path must be a directory.' });
    }

    const files = await collectWorkspaceFiles(absPath);
    if (!files.length) {
      return res.json({
        status: 'ok',
        total_files: 0,
        crypto_files_found: 0,
        message: 'No supported source files found in directory.',
        basic_analysis: [],
        detailed_reviews: [],
      });
    }

    const versionId = `local:${crypto.createHash('sha1').update(absPath).digest('hex')}:${stat.mtimeMs}`;
    registerWorkspace({ id: versionId, root: absPath, scanRoot: absPath, meta: { source: 'local', path: absPath } });

    const scan = await runWorkspaceScan({
      files: files.map((file) => ({ path: file.path, content: file.content })),
      versionId,
      sourceType: 'local',
      sourceLocator: absPath,
      meta: { path: absPath },
      concurrency,
    });

    enrichFindingsForVersion(versionId).catch((err) => {
      log.warn('enrich (local) failed', { error: String(err?.message || err) });
    });

    const response = buildAnalysisResult(scan);
    response.versionId = versionId;
    return res.json(response);
  } catch (err) {
    log.error('api/analyze error', { error: String(err?.message || err) });
    return res.status(500).json({ error: 'Failed to analyze directory.' });
  }
});

// SSE endpoint for local directory scanning with real-time progress
router.options('/api/analyze-sse', cors(corsOptions));
router.get('/api/analyze-sse', cors(corsOptions), async (req, res) => {
  const targetPath = String(req.query.path || '').trim();
  const concurrency = parseInt(String(req.query.concurrency || ''), 10);

  if (!targetPath) {
    res.status(400).json({ error: 'Missing `path` query parameter.' });
    return;
  }

  const absPath = path.resolve(targetPath);
  const stat = await safeStat(absPath);
  if (!stat) {
    res.status(404).json({ error: 'Path not found.' });
    return;
  }
  if (!stat.isDirectory()) {
    res.status(400).json({ error: 'Path must be a directory.' });
    return;
  }

  res.status(200);
  // CORS headers for SSE
  const origin = String(req.headers.origin || '');
  const isAllowed = origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin));
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Last-Event-ID');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Last-Event-ID');
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  log.info('sse connection open', { endpoint: 'analyze-sse', path: absPath });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush(); // Explicitly flush to ensure immediate delivery
  };

  let cancelled = false;
  // Disable timeouts and enable keepalive on the socket for long-running scans
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

