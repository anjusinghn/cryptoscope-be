const { loadScanResult, searchChunksByVector, toVectorLiteral, updateFindingsEnrichment } = require('../db');
const { searchChunks: searchChunksLance } = require('../db/lance');
const { embedTexts } = require('../utils/embed');
const log = require('../utils/logger');

const DEFAULT_BATCH = Number(process.env.ENRICHMENT_BATCH || 8);

function heuristicEnrichment(finding) {
  const out = {
    primitive: 'unknown',
    algorithm: 'unknown',
    mode: 'unknown',
    key_size: 'unknown',
    iv_usage: 'unknown',
    salt_usage: 'unknown',
    risk_summary: finding.description || finding.ruleId || 'Crypto usage detected',
  };
  const rule = String(finding.ruleId || '').toLowerCase();
  const desc = String(finding.description || '').toLowerCase();
  const match = String(finding.match || '').toLowerCase();
  const category = String(finding.category || '').toLowerCase();

