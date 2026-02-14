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
app.use(filesRouter);
app.use(uploadRouter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.ZIP_MAX_BYTES || 80 * 1024 * 1024),
  },
});

initDb().catch((err) => {
  log.error('database initialization error', { error: String(err?.message || err) });
});

const HEALTH_PAYLOAD = Object.freeze({ ok: true, service: 'cryptoscope-be', version: '0.2.0' });

const SUPPORTED_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.c', '.cc', '.cpp', '.hpp', '.h', '.java', '.py', '.rb', '.go', '.rs', '.swift', '.cs', '.php', '.kt', '.scala', '.m', '.mm', '.sol', '.rs', '.rb', '.pl', '.sh', '.lua', '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.txt', '.md', '.lock', '.gradle', '.pom', '.xml', '.groovy', '.coffee', '.dart'
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', 'out', 'target', '.next', '.turbo', '.cache']);

