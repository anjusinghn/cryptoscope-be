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
