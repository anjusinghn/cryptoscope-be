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
