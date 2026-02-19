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
    index,
    severity: map[f.severity] || 'low',
    reason: `Mapped from static severity '${f.severity}'.`,
  }));
  const enriched = findings.map((f, i) => ({ ...f, rankedSeverity: items[i].severity, rankReason: items[i].reason }));
  return { items, enriched, usedLLM: false };
}

function summarizeFindingForPrompt(f, index) {
  return {
    index,
    ruleId: f.ruleId,
    category: f.category,
    initialSeverity: f.severity,
    description: f.description,
    snippet: typeof f.match === 'string' ? (f.match.length > 200 ? f.match.slice(0, 200) + '…' : f.match) : String(f.match),
    line: f.line,
    column: f.column,
  };
}

/**
 * Classify findings into low/medium/high using Groq via LangChain.
 * Returns { items: [{index, severity, reason}], enriched: findingsWithRank, usedLLM: boolean }
 */
async function classifyFindingsWithGroq(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return { items: [], enriched: [], usedLLM: false };
  if (!API_KEY) return fallbackRank(findings);

  try {
    const SAMPLE_MAX = Math.max(1, Math.min(200, parseInt(process.env.GROQ_CLASSIFY_MAX || '64', 10)));
    const toClassify = findings.map((f, i) => summarizeFindingForPrompt(f, i));
    const sliced = toClassify.slice(0, SAMPLE_MAX);

    const ItemSchema = z.object({
      index: z.number(),
      severity: z.enum(['low', 'medium', 'high']),
      reason: z.string().min(1),
    });
    const OutputSchema = z.object({ items: z.array(ItemSchema) });

    const model = await getChatGroq();
    const runnable = model.withStructuredOutput(OutputSchema);

    const system = `You are a security triage assistant. Classify crypto/security findings into severities: low, medium, or high.
Rules for severity:
- high: clear and impactful security risk, insecure algorithms (e.g., MD5/SHA-1), broken modes (ECB), zero IVs, missing auth in AEAD, hardcoded secrets, tiny PBKDF2 iterations, etc.
- medium: potentially risky or context-dependent issues, weak parameters, deprecated usage without immediate exploit.
- low: informational or best-practice recommendations with low direct risk.
Respond with a JSON object that matches the provided schema strictly.`;

    const user = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Classify the following findings. Keep indexes aligned.
Return: { "items": Array<{ index, severity, reason }> }
Findings JSON:`,
          },
          { type: 'text', text: JSON.stringify(sliced) },
        ],
      },
    ];

    const result = await runnable.invoke([
