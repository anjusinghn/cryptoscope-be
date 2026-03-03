const parser = require('@babel/parser');
const log = require('./logger');

function sliceLines(lines, start, end) {
  const s = Math.max(1, start || 1);
  const e = Math.max(s, end || s);
  return lines.slice(s - 1, e).join('\n');
}

function chunkJsOrTs(source, filename) {
  const plugins = ['jsx', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'decorators-legacy', 'dynamicImport', 'topLevelAwait'];
  if (/\.tsx?$/.test(filename || '')) plugins.push('typescript');
  if (/\.ts$/.test(filename || '')) plugins.push('importAssertions');
  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: 'unambiguous',
      allowHashBang: true,
      plugins,
    });
  } catch (err) {
    log.warn('babel parse failed, fallback chunking', { filename, error: String(err?.message || err) });
    return [];
  }
  const lines = source.split(/\r?\n/);
  const out = [];
  const pushNode = (node, label) => {
    if (!node?.loc) return;
    const start = node.loc.start.line;
    const end = node.loc.end.line;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return;
    const content = sliceLines(lines, start, end);
    out.push({ startLine: start, endLine: end, content, label });
  };
  const body = ast.program?.body || [];
  for (const node of body) {
    switch (node.type) {
      case 'FunctionDeclaration':
        pushNode(node, node.id?.name ? `function ${node.id.name}` : 'function');
        break;
      case 'ClassDeclaration':
        pushNode(node, node.id?.name ? `class ${node.id.name}` : 'class');
        break;
      case 'VariableDeclaration':
        for (const decl of node.declarations || []) {
          const init = decl?.init;
          if (!init) continue;
          if (['FunctionExpression', 'ArrowFunctionExpression'].includes(init.type) && init.loc) {
            pushNode(init, decl.id?.name ? `function ${decl.id.name}` : 'function');
          }
        }
        break;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        if (node.declaration) {
          const decl = node.declaration;
          if (decl.type === 'FunctionDeclaration') pushNode(decl, decl.id?.name ? `function ${decl.id.name}` : 'function');
          else if (decl.type === 'ClassDeclaration') pushNode(decl, decl.id?.name ? `class ${decl.id.name}` : 'class');
        }
        break;
      default:
        break;
    }
  }
  return out;
}

function findClosingBrace(source, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function chunkByRegex(source, regex, labelPrefix = 'function') {
  const out = [];
  const lines = source.split(/\r?\n/);
  let match;
  while ((match = regex.exec(source)) !== null) {
    const startIndex = match.index;
    const braceIndex = source.indexOf('{', startIndex);
    if (braceIndex === -1) continue;
    const endIndex = findClosingBrace(source, braceIndex);
    if (endIndex === -1) continue;
    const startLine = source.slice(0, startIndex).split(/\r?\n/).length || 1;
    const endLine = source.slice(0, endIndex).split(/\r?\n/).length + 1;
    const rawName = match[1] || match[2] || match[0];
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    const label = `${labelPrefix} ${name}`.trim();
    out.push({ startLine, endLine, content: sliceLines(lines, startLine, endLine), label });
  }
  return out;
}

function chunkJava(source) {
  const methodRegex = /(?:public|protected|private)?\s*(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
  return chunkByRegex(source, methodRegex, 'method');
}

function chunkC(source) {
  const funcRegex = /(?:[\w\*\s]+)?\s+(\w+)\s*\([^;]*\)\s*\{/g;
  return chunkByRegex(source, funcRegex, 'function');
}

function dedupeChunks(chunks) {
  const seen = new Set();
  const out = [];
  for (const chunk of chunks) {
    const key = `${chunk.startLine}:${chunk.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out.sort((a, b) => a.startLine - b.startLine);
}

function chunkSource({ code, language, filename }) {
  const source = String(code || '');
  const lines = source.split(/\r?\n/);
  const totalLines = lines.length;
  let chunks = [];
  switch (language) {
    case 'javascript':
    case 'typescript':
      chunks = chunkJsOrTs(source, filename || 'file.js');
      break;
    case 'java':
      chunks = chunkJava(source);
      break;
    case 'c':
    case 'cpp':
      chunks = chunkC(source);
      break;
    default:
      chunks = [];
  }

  if (!chunks || chunks.length === 0) {
    const window = Number(process.env.CHUNK_FALLBACK_LINES || 200);
    for (let start = 1; start <= totalLines; start += window) {
      const end = Math.min(totalLines, start + window - 1);
      chunks.push({ startLine: start, endLine: end, content: sliceLines(lines, start, end), label: `lines ${start}-${end}` });
    }
  }

  return dedupeChunks(chunks).map((chunk, index) => ({
    ...chunk,
    index,
  }));
}

module.exports = { chunkSource };
