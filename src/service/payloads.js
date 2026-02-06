const path = require('path');

function sanitizeFinding(f) {
  return {
    id: f.id,
    line: f.line,
    column: f.column,
    match: f.match,
    ruleId: f.ruleId,
    category: f.category,
    severity: f.severity,
    description: f.description,
    recommendation: f.recommendation,
    chunkId: f.chunkId,
    enrichment: f.enrichment || null,
  };
}

function sanitizeFile(file) {
  return {
    path: file.path,
    language: file.language,
    size: file.size,
    summary: file.summary,
    findings: Array.isArray(file.findings) ? file.findings.map(sanitizeFinding) : [],
    chunks: Array.isArray(file.chunks)
      ? file.chunks.map((chunk) => ({
          index: chunk.index,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          label: chunk.label,
        }))
