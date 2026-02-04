const express = require('express');
const log = require('../utils/logger');
const { scanCode } = require('../scanner');
const { buildFileArtifacts } = require('../service/artifacts');
const { enrichFindingsInMemory } = require('../llm/enrich');
const { loadScanResult } = require('../db');
const { sanitizeFile } = require('../service/payloads');

const router = express.Router();

router.post('/api/scan', async (req, res) => {
  try {
    const { code, filename } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing `code` string in body.' });
    }
    const fname = filename || 'snippet';
