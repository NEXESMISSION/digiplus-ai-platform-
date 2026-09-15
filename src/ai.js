// OpenAI client (plain fetch). Every call returns the exact token usage and its cost.

const TIMEOUT_MS = 90_000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

// USD per 1M tokens (gpt-5-mini list prices). Override in .env if OpenAI changes them.
const PRICE = {
  input: Number(process.env.OPENAI_PRICE_INPUT) || 0.25,
  cached: Number(process.env.OPENAI_PRICE_CACHED) || 0.025,
  output: Number(process.env.OPENAI_PRICE_OUTPUT) || 2,
};

const isConfigured = () => Boolean(process.env.OPENAI_API_KEY);

// Conversations must start with the client and alternate roles:
// drop leading bot turns and merge consecutive messages from the same side.
function normalizeTurns(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').trim();
    if (!content) continue;
    if (!out.length && role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

function costOf(usage) {
  return ((usage.input - usage.cached) * PRICE.input + usage.cached * PRICE.cached + usage.output * PRICE.output) / 1e6;
}

async function generate({ system, messages, json = false, maxOutputTokens = 1500, effort = 'low' }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const turns = normalizeTurns(messages);
  if (!turns.length) throw new Error('No client message to answer');

  const body = {
    model: MODEL,
    messages: [{ role: 'developer', content: system }, ...turns],
    max_completion_tokens: maxOutputTokens,
  };
  if (/^(gpt-5|o\d)/.test(MODEL)) body.reasoning_effort = effort;
  if (json) body.response_format = { type: 'json_object' };

  const started = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || res.statusText}`);

  const u = data.usage || {};
  const usage = {
    input: u.prompt_tokens || 0,
    cached: u.prompt_tokens_details?.cached_tokens || 0,
    output: u.completion_tokens || 0,
    reasoning: u.completion_tokens_details?.reasoning_tokens || 0,
  };
  const choice = data.choices?.[0];
  const result = {
    text: (choice?.message?.content || '').trim(),
    model: data.model || MODEL,
    usage,
    costUsd: costOf(usage),
    ms: Date.now() - started,
  };
  if (!result.text) {
    const error = new Error(`OpenAI returned an empty answer (reason: ${choice?.finish_reason || 'unknown'})`);
    error.result = result; // the tokens were still billed
    throw error;
  }
  return result;
}

module.exports = { generate, isConfigured, MODEL, PRICE };
