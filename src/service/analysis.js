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

