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
      : [],
  };
}

function buildRepoPayload({ scan, repoMeta, root, cached }) {
  const summary = scan.summary || scan.version?.summary || { total: 0, byCategory: {}, bySeverity: {} };
  const files = Array.isArray(scan.files) ? scan.files.map(sanitizeFile) : [];
  return {
    repo: {
      id: repoMeta?.id || null,
      url: repoMeta?.url || null,
      owner: repoMeta?.owner || null,
      repo: repoMeta?.repo || null,
      ref: repoMeta?.ref || null,
      subpath: repoMeta?.subpath || null,
      commit: repoMeta?.commit || null,
