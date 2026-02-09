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
