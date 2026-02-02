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
