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
    versionId, 
    total, 
    sourceType, 
    sourceLocator, 
    meta,
    step: 'DETECT_START'
  });
  
  // Log file types being scanned
  const fileTypes = files.map(f => {
    const ext = f.path.split('.').pop()?.toLowerCase();
    return ext;
  }).filter(Boolean);
  const typeCounts = fileTypes.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  
  log.info('File types to scan', { versionId, typeCounts, total });
  
  if (onProgress) await onProgress({ done: 0, total });

  await new Promise((resolve, reject) => {
    let idx = 0;
    let active = 0;
    const next = () => {
      if (signal?.aborted) return reject(new Error('aborted'));
      if (completed >= total && active === 0) return resolve();
      while (active < concurrency && idx < total) {
        const file = files[idx++];
        active += 1;
        (async () => {
          try {
            const content = typeof file.content === 'function' ? await file.content() : file.content;
            log.info('=== DETECT: Scanning file ===', { 
              versionId, 
              path: file.path, 
              size: content?.length || 0,
              step: 'DETECT_FILE_START'
            });
            
            const scan = await scanCodeAsync(content, file.path);
