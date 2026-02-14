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
    const result = scanCode(code, fname);
    const artifact = await buildFileArtifacts({ path: fname, code, scanResult: result });
    try {
      const enriched = await enrichFindingsInMemory({
        findings: artifact.findings,
        chunks: artifact.chunks,
        path: artifact.path,
        versionId: 'snippet',
      });
      artifact.findings = artifact.findings.map((f, idx) => ({
        ...f,
        enrichment: enriched[idx]?.enrichment || f.enrichment || null,
      }));
    } catch (err) {
      log.warn('single-file enrichment failed', { error: String(err?.message || err) });
    }
    return res.json({
      filename: artifact.path,
      language: artifact.language,
      summary: artifact.summary,
      findings: artifact.findings,
      lines: result.lines || String(code).split(/\r?\n/).length,
      truncated: result.truncated,
      generatedAt: new Date().toISOString(),
      chunks: artifact.chunks.map((c) => ({ index: c.index, label: c.label, startLine: c.startLine, endLine: c.endLine })),
      content: artifact.content,
    });
  } catch (err) {
    log.error('api/scan error', { error: String(err?.message || err) });
    return res.status(500).json({ error: 'Internal error during scan.' });
  }
});

