#!/usr/bin/env node
/*
 Simple analyzer CLI that uses all backend API endpoints:
 - /api/scan for single files or pasted code
 - /api/scan-repo-sse to scan a GitHub repo with streaming progress
 - /api/repo-file to fetch file contents
 - /api/rank-severity to classify severity (optional)
 - /api/generate-report to produce a Markdown report

 Usage:
   node be/scripts/analyzer.js scan-file <path>
   node be/scripts/analyzer.js scan-repo <github_url>
*/

const fs = require('fs');
const http = require('http');
const https = require('https');

const API = process.env.ANALYZER_API || 'http://localhost:5050';

