const { DEFAULT_CONCURRENCY, INDEXING_DISABLED } = require('../config');
const { scanWorkspace } = require('../service/pipeline');

async function runWorkspaceScan({ files, versionId, sourceType, sourceLocator, meta, concurrency }) {
  return await scanWorkspace({
    files,
    versionId,
    sourceType,
    sourceLocator,
    meta,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY,
    skipIndexing: INDEXING_DISABLED,
  });
}

module.exports = {
  runWorkspaceScan,
};
