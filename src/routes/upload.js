const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const extract = require('extract-zip');
const log = require('../utils/logger');
const { cors, corsOptions, ALLOWED_ORIGINS, DEFAULT_CONCURRENCY, INDEXING_DISABLED } = require('../config');
const { getCachedScan, scanWorkspace } = require('../service/pipeline');
const { buildAnalysisResult } = require('../service/analysis');
const { collectWorkspaceFiles } = require('../lib/filesystem');
const { enrichFindingsForVersion } = require('../llm/enrich');
const { runWorkspaceScan } = require('../service/scan');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.ZIP_MAX_BYTES || 80 * 1024 * 1024),
