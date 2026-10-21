// Vercel serverless function: proxies the Tech English Coach to OpenAI (default) or Anthropic.
// Env vars:
//   OPENAI_API_KEY      -> uses OpenAI Chat Completions (OPENAI_MODEL, default gpt-4.1-mini)
//   ANTHROPIC_API_KEY   -> uses Anthropic Messages API (ANTHROPIC_MODEL, default claude-sonnet-5-5)
//   APP_PASSWORD        -> access code the page must send (recommended)

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

function readBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  return body;
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
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "no_password", message: "APP_PASSWORD não está configurada na Vercel. Defina um código de acesso antes de usar." });
    return;
  }
  if ((req.headers["x-app-code"] || "") !== expected) {
    res.status(401).json({ error: "bad_code", message: "Código de acesso inválido." });
    return;
  }

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
  const maxTokens = Math.max(100, Math.min(Number(body.max_tokens) || 700, 2000));

  try {
    if (openaiKey) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + openaiKey },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_completion_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, ...messages]
        })
      });
      const data = await r.json();
      if (!r.ok) { res.status(r.status).json({ error: "provider_error", message: (data && data.error && data.error.message) || "Erro na API da OpenAI." }); return; }
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
