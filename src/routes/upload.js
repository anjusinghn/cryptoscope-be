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
  },
});

router.post('/api/upload-zip', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Missing file upload.' });
  }
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cryptoscope-zip-'));
  const zipPath = path.join(tempDir, 'upload.zip');
  try {
    await fs.promises.writeFile(zipPath, req.file.buffer);
    const extractDir = path.join(tempDir, 'extract');
    await fs.promises.mkdir(extractDir, { recursive: true });
    await extract(zipPath, { dir: extractDir });

    const cacheKey = `zip:${hash}`;
    if (!req.body?.force) {
      const cached = await getCachedScan(cacheKey);
      if (cached) {
        const response = buildAnalysisResult(cached);
        response.status = 'cached';
        return res.json(response);
      }
    }

    const files = await collectWorkspaceFiles(extractDir);
    if (!files.length) {
      return res.json({
        status: 'ok',
        total_files: 0,
        crypto_files_found: 0,
        message: 'Archive uploaded but no supported source files were found.',
        basic_analysis: [],
        detailed_reviews: [],
      });
    }

    const scan = await runWorkspaceScan({
      files: files.map((file) => ({ path: file.path, content: file.content })),
      versionId: cacheKey,
      sourceType: 'zip',
