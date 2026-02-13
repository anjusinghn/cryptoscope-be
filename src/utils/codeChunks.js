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
