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
