require('dotenv').config();
const express = require('express');
const { PORT, DEFAULT_CONCURRENCY, MAX_SCAN_FILES, cors, corsOptions, INDEXING_DISABLED } = require('./config');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const extract = require('extract-zip');
const { spawnSync } = require('child_process');

const log = require('./utils/logger');
const { scanCode } = require('./scanner');
const { cloneGithub, parseGithubUrl, registerWorkspace, getRepoMeta } = require('./repo/github');
const { buildFileArtifacts } = require('./service/artifacts');
const { scanWorkspace, getCachedScan } = require('./service/pipeline');
const { enrichFindingsInMemory, enrichFindingsForVersion } = require('./llm/enrich');
const { classifyFindingsWithGroq, generateReportWithGroq } = require('./llm/groq');
const { initDb, loadScanResult } = require('./db');
const { searchChunks: searchChunksLance } = require('./db/lance');
const { embedTexts } = require('./utils/embed');
const { heuristicEnrichment } = require('./llm/enrich');

const app = express();

// Config --------------------------------------------------------------

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// Routers -------------------------------------------------------------
const healthRouter = require('./routes/health');
const llmRouter = require('./routes/llm');
const scanRouter = require('./routes/scan');
const analyzeRouter = require('./routes/analyze');
const repoRouter = require('./routes/repo');
const filesRouter = require('./routes/files');
const uploadRouter = require('./routes/upload');

app.use(healthRouter);
app.use(llmRouter);
app.use(scanRouter);
app.use(analyzeRouter);
app.use(repoRouter);
