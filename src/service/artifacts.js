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
        ...f,
        raw: f,
      }))
    : [];

  const disableIndexing = typeof skipIndexing === 'boolean' ? skipIndexing : INDEXING_DISABLED;

  if (disableIndexing) {
    log.info('=== INDEX: Skipping code indexing per configuration ===', {
      path,
      language,
      findings: findings.length,
      step: 'INDEX_DISABLED',
    });

    return {
      path,
      language,
      size: Buffer.byteLength(content, 'utf8'),
      summary,
      findings,
      chunks: [],
      content,
    };
  }

  log.info('=== INDEX: Chunking source code ===', { 
    path, 
    language, 
    content_length: content.length,
    step: 'INDEX_CHUNK_START'
  });
  
  const chunks = chunkSource({ code: content, language, filename: path });
  
  log.info('=== INDEX: Chunks created, generating embeddings ===', { 
    path, 
    chunks: chunks.length,
    step: 'INDEX_EMBED_START'
  });
  
  const chunkTexts = chunks.map((c) => `passage: ${clampText(c.content, 1800)}`);
  const embeddings = await embedTexts(chunkTexts);
  
  if (embeddings.length !== chunks.length) {
    log.warn('embedding count mismatch', { path, chunks: chunks.length, embeddings: embeddings.length });
  }
  
  log.info('=== INDEX: Embeddings generated, building artifacts ===', { 
    path, 
    chunks: chunks.length,
    embeddings: embeddings.length,
    step: 'INDEX_EMBED_COMPLETE'
  });
  
  const enrichedChunks = chunks.map((chunk, idx) => ({
    index: idx,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    label: chunk.label,
