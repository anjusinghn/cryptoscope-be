const { scanCodeAsync } = require('../scanner/scanAsync');
const { buildFileArtifacts, summarizeFiles } = require('./artifacts');
const { storeScanResult, loadScanResult } = require('../db');
const { INDEXING_DISABLED } = require('../config');
const log = require('../utils/logger');

async function scanWorkspace({
  files,
  versionId,
  sourceType,
  sourceLocator,
  meta = {},
  concurrency = 4,
  onFile,
  onProgress,
  signal,
  skipIndexing,
}) {
  const results = [];
  const total = files.length;
  let completed = 0;
  let summary = { total: 0, byCategory: {}, bySeverity: {} };
  const indexingDisabled = typeof skipIndexing === 'boolean' ? skipIndexing : INDEXING_DISABLED;

  log.info('=== CRYPTOSCOPE ANALYSIS PIPELINE START ===', { 
    versionId, 
    total, 
    sourceType, 
    sourceLocator, 
    meta,
    concurrency,
    step: 'INGEST_COMPLETE',
    indexingDisabled,
  });

  if (total === 0) {
    log.info('No files to scan, storing empty result', { versionId });
    await storeScanResult({ versionId, sourceType, sourceLocator, summary, meta: {}, files: [] });
    return { versionId, summary, files: [] };
  }

  log.info('=== STEP 1: DETECT - Starting Semgrep analysis ===', { 
