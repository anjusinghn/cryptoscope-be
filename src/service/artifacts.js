const { chunkSource } = require('../utils/codeChunks');
const { embedTexts } = require('../utils/embed');
const { detectLanguage } = require('../utils/detectLanguage');
const { INDEXING_DISABLED } = require('../config');
const log = require('../utils/logger');

function clampText(text, maxChars = 4000) {
  const str = String(text || '');
  return str.length > maxChars ? str.slice(0, maxChars) : str;
}

async function buildFileArtifacts({ path, code, scanResult, skipIndexing }) {
  const content = String(code || '');
  const language = scanResult?.language && scanResult.language !== 'any'
    ? scanResult.language
    : detectLanguage(path, content);

  const summary = scanResult?.summary || { total: 0, byCategory: {}, bySeverity: {} };
  const findings = Array.isArray(scanResult?.findings)
    ? scanResult.findings.map((f) => ({
