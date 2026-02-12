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
