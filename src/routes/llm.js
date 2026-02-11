const express = require('express');
const log = require('../utils/logger');
const { classifyFindingsWithGroq, generateReportWithGroq } = require('../llm/groq');
const { loadScanResult } = require('../db');

const router = express.Router();

router.post('/api/rank-severity', async (req, res) => {
  try {
    const { findings } = req.body || {};
    if (!Array.isArray(findings)) {
      return res.status(400).json({ error: 'Body must include `findings` array.' });
    }
    const result = await classifyFindingsWithGroq(findings);
    return res.json(result);
  } catch (err) {
    log.error('api/rank-severity error', { error: String(err?.message || err) });
    return res.status(500).json({ error: 'Failed to classify severities.' });
  }
});

// Explain a specific finding with optional snippet using Groq (fallbacks internally)
router.post('/api/explain-finding', async (req, res) => {
  try {
    const { versionId, filePath, finding, snippet } = req.body || {};
    const f = finding || {};
    const base = {
      ruleId: f.ruleId,
      category: f.category,
      severity: f.severity,
