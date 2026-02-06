const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../utils/logger');
const { MAX_SCAN_FILES } = require('../config');

const SUPPORTED_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.c', '.cc', '.cpp', '.hpp', '.h', '.java', '.py', '.rb', '.go', '.rs', '.swift', '.cs', '.php', '.kt', '.scala', '.m', '.mm', '.sol', '.rs', '.rb', '.pl', '.sh', '.lua', '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.txt', '.md', '.lock', '.gradle', '.pom', '.xml', '.groovy', '.coffee', '.dart'
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', 'out', 'target', '.next', '.turbo', '.cache']);

function posixPath(p) {
  return p.split(path.sep).join('/');
}

async function safeStat(p) {
  try {
    return await fs.promises.stat(p);
  } catch (err) {
    return null;
  }
}

async function collectWorkspaceFiles(root) {
  log.info('=== COLLECT FILES: Starting file collection ===', { 
    root,
    step: 'COLLECT_START'
  });
  
  const queue = [root];
  const results = [];
  const visited = new Set();
  const rootReal = await fs.promises.realpath(root).catch(() => root);
  
  log.info('=== COLLECT FILES: Root resolved ===', { 
    root,
    rootReal,
