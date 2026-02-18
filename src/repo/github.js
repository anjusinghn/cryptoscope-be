const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../utils/logger');

const repoCache = new Map();

function parseGithubUrl(url) {
  // Accepts forms:
  // - https://github.com/owner/repo[.git][/tree/<ref>/<subpath>]
  // - git@github.com:owner/repo.git
  // - github.com/owner/repo
  // - owner/repo
  try {
    const raw = String(url || '').trim();
    let owner = null, repo = null, ref = null, subpath = '';

    if (/^git@github\.com:/i.test(raw)) {
      const m = raw.match(/^git@github\.com:([^/]+)\/([^\s]+?)(?:\.git)?$/i);
      if (m) { owner = m[1]; repo = m[2].replace(/\.git$/i, ''); }
    } else {
      // Normalize shorthand to a full https URL for URL() parsing
      let normalized = raw;
      if (/^github\.com\//i.test(normalized)) {
        normalized = 'https://' + normalized;
      } else if (/^www\.github\.com\//i.test(normalized)) {
        normalized = 'https://' + normalized.replace(/^www\./i, '');
      } else if (!/^https?:\/\//i.test(normalized)) {
        // Treat as owner/repo or owner/repo/...
        normalized = 'https://github.com/' + normalized;
      }

      const u = new URL(normalized);
      if (!/^(?:www\.)?github\.com$/i.test(u.hostname)) throw new Error('Only github.com supported');
      const parts = u.pathname.replace(/^\//,'').split('/');
      owner = parts[0] || null;
      repo = (parts[1] || '').replace(/\.git$/i, '') || null;
      if (parts[2] === 'tree') {
        ref = parts[3] || null;
        subpath = parts.slice(4).join('/');
      }
    }
    if (!owner || !repo) throw new Error('Invalid GitHub URL');
    const parsed = { owner, repo, ref, subpath };
    log.debug('parseGithubUrl', { url: raw, parsed });
    return parsed;
  } catch (e) {
    throw new Error('Invalid GitHub URL');
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    log.info('spawn start', { cmd, args });
    const p = spawn(cmd, args, { ...opts });
    let out = '', err = '';
    p.stdout && p.stdout.on('data', (d) => {
      const msg = d.toString();
      out += msg;
      log.info('spawn stdout', { cmd, msg });
    });
    p.stderr && p.stderr.on('data', (d) => {
      const msg = d.toString();
      err += msg;
      log.warn('spawn stderr', { cmd, msg });
    });
    p.on('close', (code) => {
      const dur = Date.now() - t0;
      log.info('spawn done', { cmd, code, duration_ms: dur, stdout_len: out.length, stderr_len: err.length });
      if (code === 0) resolve({ code, stdout: out, stderr: err });
      else reject(new Error(err || (`${cmd} exited ${code}`)));
    });
  });
}

async function cloneGithub(url) {
  const { owner, repo, ref, subpath } = parseGithubUrl(url);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptoscope-repo-'));
  const root = path.join(tmp, repo);
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const args = ['clone', '--depth', '1'];
  if (ref) { args.push('--branch', ref); }
  args.push(cloneUrl, root);
  log.info('git clone starting', { owner, repo, ref: ref || null, subpath });
