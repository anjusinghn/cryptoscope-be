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
