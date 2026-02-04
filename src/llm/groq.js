// LangChainJS + Groq helpers for severity ranking and reporting
// CommonJS wrapper using dynamic import for ESM-only packages

const { z } = require('zod');

// Updated default to a supported model; override via GROQ_MODEL
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const API_KEY = process.env.GROQ_API_KEY || '';

async function getChatGroq() {
  const { ChatGroq } = await import('@langchain/groq');
  const model = new ChatGroq({
    apiKey: API_KEY,
    model: DEFAULT_MODEL,
    temperature: 0,
  });
  return model;
}

function fallbackRank(findings) {
  // Map existing severities to low/medium/high deterministically
  const map = { high: 'high', warning: 'medium', info: 'low' };
  const items = findings.map((f, index) => ({
