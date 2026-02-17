const express = require('express');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');
const { getRepoMeta } = require('../repo/github');
const { loadScanResult } = require('../db');
const { searchChunks: searchChunksLance } = require('../db/lance');
const { embedTexts } = require('../utils/embed');
const { heuristicEnrichment } = require('../llm/enrich');

const router = express.Router();

// Return file content from saved scan payload (preferred for Findings page)
router.get('/api/scan-file', async (req, res) => {
  try {
    const versionId = String(req.query.versionId || req.query.version_id || '').trim();
    const rel = String(req.query.path || '').trim();
    if (!versionId || !rel) return res.status(400).json({ error: 'Missing versionId or path' });
    const scan = await loadScanResult(versionId);
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    const file = (scan.files || []).find((f) => (
      f.path === rel || rel.endsWith(f.path) || rel.endsWith('/' + f.path) || rel.endsWith('\\' + f.path)
    ));
    if (!file) return res.status(404).json({ error: 'File not found in scan' });
    if (typeof file.content === 'string') return res.json({ content: file.content });
    // As a fallback, attempt repo meta root if present in memory (best-effort)
    try {
      const meta = getRepoMeta(versionId);
      const root = meta?.scanRoot || meta?.root;
      if (root) {
        const full = path.join(root, file.path);
        const content = await fs.promises.readFile(full, 'utf8');
        return res.json({ content });
      }
    } catch {}
    return res.status(404).json({ error: 'File content unavailable' });
  } catch (err) {
    log.error('api/scan-file error', { error: String(err?.message || err) });
    return res.status(500).json({ error: 'Failed to load file from scan' });
  }
});

// Return raw file from a registered repo/workspace
router.get('/api/repo-file', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const rel = String(req.query.path || '');
    if (!id || !rel) return res.status(400).json({ error: 'Missing id or path' });
    const meta = getRepoMeta(id);
    const root = meta?.scanRoot || meta?.root;
    if (!root) return res.status(404).json({ error: 'Workspace not found' });
    const full = path.join(root, rel);
    try {
      const content = await fs.promises.readFile(full, 'utf8');
      return res.json({ content });
    } catch (err) {
      log.warn('api/repo-file read failed', { id, rel, error: String(err?.message || err) });
      return res.status(404).json({ error: 'File not found' });
    }
  } catch (err) {
    log.error('api/repo-file error', { error: String(err?.message || err) });
    return res.status(500).json({ error: 'Failed to read file' });
  }
});

// Return primitives and context for a scanned file
router.get('/api/file-primitives', async (req, res) => {
  try {
    const versionId = String(req.query.versionId || req.query.version_id || '').trim();
    const rel = String(req.query.path || '').trim();
    if (!versionId || !rel) return res.status(400).json({ error: 'Missing versionId or path' });
    const scan = await loadScanResult(versionId);
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    const file = (scan.files || []).find((f) => (
      f.path === rel ||
      rel.endsWith(f.path) ||
      rel.endsWith('/' + f.path) ||
      rel.endsWith('\\' + f.path)
    ));
    if (!file) return res.status(404).json({ error: 'File not found in scan' });

    const outputs = [];
    for (const f of (file.findings || [])) {
      const finding = {
