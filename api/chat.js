// Vercel serverless function: proxies the Tech English Coach to OpenAI (default) or Anthropic.
// Env vars:
//   OPENAI_API_KEY      -> uses OpenAI Chat Completions (OPENAI_MODEL, default gpt-6-astra; OPENAI_REASONING, default "low")
//   ANTHROPIC_API_KEY   -> uses Anthropic Messages API (ANTHROPIC_MODEL, default claude-sonnet-5-5)
//   APP_PASSWORD        -> access code the page must send (required)

// "smart" tier (activity generation): the most capable model. "fast" tier (chat replies, feedback cards,
// translations, grading): a quick model with no reasoning, so the student is not kept waiting.
const { guard } = require("./_auth");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
const OPENAI_REASONING = process.env.OPENAI_REASONING || "low";
const OPENAI_FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-6-luna";
const FALLBACKS = ["gpt-5.4-mini", "gpt-4.1-mini"];
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

function readBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  return body;
}

async function openaiChat(key, system, messages, maxTokens, tier) {
  const first = tier === "fast" ? OPENAI_FAST_MODEL : OPENAI_MODEL;
  const models = [first].concat(FALLBACKS).filter((m, i, a) => a.indexOf(m) === i);
  let last = { ok: false, status: 500, message: "Não foi possível montar a requisição." };
  for (const model of models) {
    let payload = { model, max_completion_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages], response_format: { type: "json_object" } };
    if (tier !== "fast" && /^(gpt-5|gpt-6|o\d)/.test(model) && OPENAI_REASONING !== "none") payload.reasoning_effort = OPENAI_REASONING;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + key },
        body: JSON.stringify(payload)
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, data };
      const msg = (data && data.error && data.error.message) || "";
      last = { ok: false, status: r.status, message: msg || "Erro na API da OpenAI." };
      // a model that rejects one of the optional parameters: drop it and try again
      if (r.status === 400 && /reasoning_effort/i.test(msg) && payload.reasoning_effort) { payload = Object.assign({}, payload); delete payload.reasoning_effort; continue; }
      if (r.status === 400 && /response_format/i.test(msg) && payload.response_format) { payload = Object.assign({}, payload); delete payload.response_format; continue; }
      break;
    }
    // only move on to the next model when this one does not exist / is not available to the account
    if (!(last.status === 404 || /model/i.test(last.message))) return last;
  }
  return last;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) {
    res.status(500).json({ error: "no_api_key", message: "Nenhuma chave configurada na Vercel (OPENAI_API_KEY ou ANTHROPIC_API_KEY)." });
    return;
  }
  if (!guard(req, res)) return;

  const body = readBody(req);
  if (!body || typeof body.system !== "string" || !Array.isArray(body.messages) || !body.messages.length) {
    res.status(400).json({ error: "bad_request", message: "Requisição inválida." }); return;
  }
  const messages = body.messages.slice(-21)
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (messages.length && messages[0].role !== "user") messages.shift(); // history must open with the student
  if (!messages.length) { res.status(400).json({ error: "bad_request", message: "Requisição inválida." }); return; }
  const system = body.system.slice(0, 12000);
  const maxTokens = Math.max(100, Math.min(Number(body.max_tokens) || 700, 4000));

  try {
    if (openaiKey) {
      const out = await openaiChat(openaiKey, system, messages, maxTokens, body.tier === "fast" ? "fast" : "smart");
      if (!out.ok) { res.status(out.status).json({ error: "provider_error", message: out.message }); return; }
      const data = out.data;
      const choice = data.choices && data.choices[0];
      const text = (choice && choice.message && choice.message.content) || "";
      if (choice && choice.finish_reason === "length") {
        res.status(502).json({ error: "truncated", message: "A resposta foi cortada por tamanho. Tente de novo." }); return;
      }
      res.status(200).json({ text, model: data.model, provider: "openai" });
      return;
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages })
    });
    const data = await r.json();
    if (!r.ok) { res.status(r.status).json({ error: "provider_error", message: (data && data.error && data.error.message) || "Erro na API da Anthropic." }); return; }
    const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    res.status(200).json({ text, model: data.model, provider: "anthropic" });
  } catch (e) {
    res.status(502).json({ error: "upstream", message: String(e && e.message || e) });
  }
};
