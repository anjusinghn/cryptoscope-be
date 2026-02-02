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
