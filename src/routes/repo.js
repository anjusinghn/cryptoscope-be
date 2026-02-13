const express = require('express');
const path = require('path');
const { cors, corsOptions, ALLOWED_ORIGINS, DEFAULT_CONCURRENCY, INDEXING_DISABLED } = require('../config');
const log = require('../utils/logger');
const { parseGithubUrl, cloneGithub, registerWorkspace } = require('../repo/github');
const { getCachedScan, scanWorkspace } = require('../service/pipeline');
const { collectWorkspaceFiles } = require('../lib/filesystem');
const { buildRepoPayload } = require('../service/payloads');
const { buildAnalysisResult } = require('../service/analysis');
const { enrichFindingsForVersion } = require('../llm/enrich');

const router = express.Router();

// Clone + analyze (REST)
router.post('/api/git-clone', async (req, res) => {
  try {
    const { git_url, url, force, concurrency } = req.body || {};
    const target = String(git_url || url || '').trim();
    if (!target) {
      return res.status(400).json({ error: 'Missing `git_url` string.' });
    }

    let parsed;
    try {
      parsed = parseGithubUrl(target);
    } catch (err) {
      log.warn('api/git-clone invalid url', { url: target });
      return res.status(400).json({ error: 'Invalid GitHub URL. Only github.com is supported.' });
    }

    const { id, scanRoot, versionId, meta } = await cloneGithub(target);
    log.info('=== GIT CLONE COMPLETE - Starting analysis ===', { 
      versionId, 
      scanRoot, 
      id,
      step: 'CLONE_COMPLETE'
    });
    
    registerWorkspace({ id, root: meta.root, scanRoot, meta: { ...meta, source: 'github' } });

    if (!force) {
      log.info('Checking for cached scan', { versionId });
      const cached = await getCachedScan(versionId);
      if (cached) {
        log.info('Found cached scan, returning cached result', { versionId });
        const response = buildAnalysisResult(cached);
        response.status = 'cached';
        return res.json(response);
      }
      log.info('No cached scan found, proceeding with analysis', { versionId });
    }

    log.info('=== COLLECTING FILES FROM WORKSPACE ===', { 
      scanRoot, 
      versionId,
      step: 'COLLECT_FILES_START'
    });
    
    const files = await collectWorkspaceFiles(scanRoot);
    const rootName = path.basename(scanRoot);
    
    log.info('=== FILES COLLECTED ===', { 
      scanRoot, 
      versionId,
      totalFiles: files.length,
      fileTypes: files.reduce((acc, f) => {
        const ext = f.path.split('.').pop()?.toLowerCase();
        if (ext) acc[ext] = (acc[ext] || 0) + 1;
