const path = require('path');

function uniqueList(items) {
  return Array.from(new Set((items || []).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)));
}

function buildBasicAnalysis(file) {
  const analysis = {
    file_path: file.path,
    file_name: path.basename(file.path),
    file_extension: path.extname(file.path).replace(/^\./, ''),
    has_crypto: false,
    crypto_imports: [],
    crypto_functions: [],
    crypto_patterns_found: [],
    crypto_algorithms_detected: [],
    code_snippets: [],
  };

  const imports = new Set();
  const patterns = new Set();
  const functions = [];
  const algorithms = [];
  const snippets = [];

  (file.findings || []).forEach((finding, idx) => {
    const snippet = typeof finding.match === 'string' ? finding.match : JSON.stringify(finding.match || '');
    const name = finding.ruleId || finding.category || `Finding ${idx + 1}`;
    if (snippet) {
      const lines = snippet.split(/\r?\n/);
      const importLine = lines.find((line) => /(^\s*import\s+)|(^\s*from\s+.+\s+import\s+)|require\s*\(|#include\s+/.test(line));
      if (importLine) imports.add(importLine.trim());
      snippets.push({ name, line_start: finding.line || null, code: snippet, type: finding.category });
    }
    patterns.add(finding.description || name);
    functions.push({ name, line_start: finding.line || null, content: snippet, type: finding.category });
    algorithms.push({
      ruleId: finding.ruleId,
