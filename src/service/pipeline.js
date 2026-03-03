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
            log.info('=== DETECT: File scan complete ===', { 
              versionId, 
              path: file.path, 
              findings: scan?.summary?.total || 0,
              by_severity: scan?.summary?.bySeverity || {},
              step: 'DETECT_FILE_COMPLETE'
            });
            
            if (!indexingDisabled) {
              log.info('=== INDEX: Building artifacts and embeddings ===', {
                versionId,
                path: file.path,
                step: 'INDEX_START',
              });
            } else {
              log.info('=== INDEX: Skipping artifact indexing ===', {
                versionId,
                path: file.path,
                step: 'INDEX_SKIPPED',
              });
            }

            const artifact = await buildFileArtifacts({
              path: file.path,
              code: content,
              scanResult: scan,
              skipIndexing: indexingDisabled,
            });

            if (!indexingDisabled) {
              log.info('=== INDEX: Artifacts complete ===', {
                versionId,
                path: file.path,
                chunks: artifact.chunks?.length || 0,
                findings: artifact.summary.total,
                embeddings: artifact.chunks?.filter(c => c.embedding?.length > 0).length || 0,
                step: 'INDEX_COMPLETE',
              });
            } else {
              log.info('=== INDEX: Stored scan summary without embeddings ===', {
                versionId,
                path: file.path,
                findings: artifact.summary.total,
                step: 'INDEX_DISABLED_COMPLETE',
              });
            }
            
            results.push(artifact);
            if (onFile) await onFile({ file: artifact });
            
            log.info('File processing complete', { 
              versionId, 
              path: file.path, 
              findings: artifact.summary.total,
              chunks: artifact.chunks?.length || 0
            });
          } catch (err) {
            log.error('scanWorkspace file error', { 
              versionId,
              path: file.path, 
              error: String(err?.message || err),
              stack: err?.stack
            });
            if (onFile) await onFile({ file: { path: file.path }, error: err });
          } finally {
            active -= 1;
            completed += 1;
            if (onProgress) await onProgress({ done: completed, total });
            next();
          }
        })().catch((err) => {
          log.error('scanWorkspace task error', { 
            versionId,
            error: String(err?.message || err),
            stack: err?.stack
          });
          active -= 1;
          completed += 1;
          next();
        });
      }
    };
    next();
  });
