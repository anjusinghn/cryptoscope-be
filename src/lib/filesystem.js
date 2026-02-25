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
    step: 'COLLECT_ROOT_RESOLVED'
  });
  
  while (queue.length) {
    const current = queue.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (err) {
      log.warn('collectWorkspaceFiles readdir failed', { path: current, error: String(err?.message || err) });
      continue;
    }
    
    log.debug('=== COLLECT FILES: Processing directory ===', { 
      current,
      entries: entries.length,
      step: 'COLLECT_PROCESS_DIR'
    });
    for (const entry of entries) {
      if (entry.name.startsWith('.git') && entry.isDirectory()) continue;
      const abs = path.join(current, entry.name);
      const rel = posixPath(path.relative(root, abs));
      if (visited.has(abs)) continue;
      visited.add(abs);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) continue;
      const canonicalRel = rel || entry.name;
      results.push({
        path: canonicalRel,
        absolutePath: abs,
        content: async () => {
          const data = await fs.promises.readFile(abs, 'utf8');
          return data;
        },
      });
      if (results.length >= MAX_SCAN_FILES) {
        log.warn('collectWorkspaceFiles limit reached', { max: MAX_SCAN_FILES, root: rootReal });
        return results;
      }
    }
  }
  
  log.info('=== COLLECT FILES: Collection complete ===', { 
    root,
    totalFiles: results.length,
    supportedExtensions: Array.from(SUPPORTED_EXT).slice(0, 10),
    step: 'COLLECT_COMPLETE'
  });
  
  return results;
}

async function describeDirectory(root) {
  const out = [];
  async function walk(dir, level) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn('describeDirectory failed', { dir, error: String(err?.message || err) });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = posixPath(path.relative(root, abs)) || entry.name;
      if (entry.isDirectory()) {
        const supported = !SKIP_DIRS.has(entry.name);
        out.push({ type: 'folder', name: entry.name, path: rel, level, supported });
        if (supported) await walk(abs, level + 1);
