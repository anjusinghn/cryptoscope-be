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
        return acc;
      }, {}),
      step: 'COLLECT_FILES_COMPLETE'
    });

    if (!files.length) {
      log.warn('=== NO FILES FOUND - Analysis complete ===', { 
        scanRoot, 
        versionId,
        step: 'NO_FILES_FOUND'
      });
      return res.json({
        status: 'ok',
        total_files: 0,
        crypto_files_found: 0,
        message: 'Repository cloned but no supported source files were found.',
        basic_analysis: [],
        detailed_reviews: [],
        repo: { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref || null, root: rootName },
      });
    }

    log.info('=== STARTING WORKSPACE SCAN ===', { 
      versionId, 
      totalFiles: files.length,
      concurrency: concurrency || 'default',
      step: 'WORKSPACE_SCAN_START'
    });

    const scan = await scanWorkspace({
      files: files.map((file) => ({ path: file.path, content: file.content })),
      versionId,
      sourceType: 'github',
      sourceLocator: target,
      meta: { repo: { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref, subpath: parsed.subpath } },
      concurrency,
      skipIndexing: INDEXING_DISABLED,
    });

    log.info('=== WORKSPACE SCAN COMPLETE - Starting enrichment ===', { 
      versionId, 
      totalFindings: scan?.summary?.total || 0,
      step: 'WORKSPACE_SCAN_COMPLETE'
    });

    enrichFindingsForVersion(versionId).catch((err) => {
      log.warn('enrich (repo) failed', { versionId, error: String(err?.message || err) });
    });

    log.info('=== ANALYSIS PIPELINE COMPLETE - Building response ===', { 
      versionId,
      step: 'ANALYSIS_COMPLETE'
    });

    const response = buildAnalysisResult(scan);
    response.repo = { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref || null, root: rootName, versionId, id };
    return res.json(response);
  } catch (err) {
    log.error('=== API/GIT-CLONE ERROR ===', { 
      error: String(err?.message || err),
      stack: err?.stack,
      versionId: err?.versionId || 'unknown',
      step: 'ERROR'
    });
    return res.status(500).json({ error: 'Failed to clone and analyze repository.' });
  }
});

// Scan repo (REST, returns repo payload)
router.post('/api/scan-repo', async (req, res) => {
  try {
    const { url, force, concurrency } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing `url` string.' });
    }
    let parsed;
    try {
      parsed = parseGithubUrl(url);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid GitHub URL.' });
    }
    const { id, scanRoot, versionId, meta } = await cloneGithub(url);
    registerWorkspace({ id, root: meta.root, scanRoot, meta: { ...meta, source: 'github' } });

    if (!force) {
      const cached = await getCachedScan(versionId);
      if (cached) {
        const payload = buildRepoPayload({ scan: cached, repoMeta: meta, root: path.basename(scanRoot), cached: true });
        return res.json(payload);
      }
