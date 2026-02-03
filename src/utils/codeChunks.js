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
