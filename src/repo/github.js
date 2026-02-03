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
