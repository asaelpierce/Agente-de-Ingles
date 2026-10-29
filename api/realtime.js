// Vercel serverless function: mints a short-lived client secret for an OpenAI Realtime voice session.
// The browser then talks to OpenAI directly over WebRTC (low latency) without ever seeing OPENAI_API_KEY.
// Env vars: OPENAI_API_KEY, APP_PASSWORD, OPENAI_REALTIME_MODEL (default gpt-realtime-2.1),
//           OPENAI_REALTIME_VOICE (default marin), OPENAI_TRANSCRIBE_MODEL (default gpt-transcribe).

const { guard } = require("./_auth");
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
const VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
const TRANSCRIBE = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";
const STT_PROMPT = "A Brazilian IT professional practicing English, sometimes mixing Portuguese. Tech terms: deploy, bug, API, server, database, pull request, merge, commit, ticket, sprint, standup, backend, frontend, cloud, pipeline, automation, ERP, Sankhya.";

function readBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  return body || {};
}

function sessionConfig(instructions, eagerness, variant) {
  const input = {};
  if (variant < 3) input.transcription = { model: variant === 0 ? TRANSCRIBE : "gpt-4o-transcribe", prompt: STT_PROMPT };
  if (variant < 2) input.noise_reduction = { type: "near_field" };
  input.turn_detection = variant < 4 ? { type: "semantic_vad", eagerness } : { type: "server_vad", silence_duration_ms: 1200 };
  return { type: "realtime", model: MODEL, instructions, audio: { input, output: { voice: VOICE } } };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: "no_api_key", message: "OPENAI_API_KEY não está configurada na Vercel." }); return; }
  if (!guard(req, res)) return;

  const body = readBody(req);
  const instructions = String(body.instructions || "").slice(0, 10000);
  if (!instructions) { res.status(400).json({ error: "bad_request", message: "Requisição inválida." }); return; }
  const eagerness = ["low", "medium", "high", "auto"].includes(body.eagerness) ? body.eagerness : "low";

  // Try the richest configuration first; if OpenAI rejects a field (naming changes between versions),
  // fall back step by step to simpler ones instead of failing the call.
  let lastMsg = "";
  for (let variant = 0; variant <= 4; variant++) {
    try {
      const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + key },
        body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: sessionConfig(instructions, eagerness, variant) })
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.value) {
        res.status(200).json({ value: data.value, expires_at: data.expires_at, model: MODEL, variant });
        return;
      }
      lastMsg = (data && data.error && data.error.message) || ("HTTP " + r.status);
      if (r.status === 401 || r.status === 403 || r.status === 429) break; // not a config problem
      if (variant === 0 && /expires_after/i.test(lastMsg)) { // older API without expires_after: retry same variant without it
        const r2 = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
          method: "POST",
          headers: { "content-type": "application/json", "authorization": "Bearer " + key },
          body: JSON.stringify({ session: sessionConfig(instructions, eagerness, variant) })
        });
        const d2 = await r2.json().catch(() => ({}));
        if (r2.ok && d2.value) { res.status(200).json({ value: d2.value, expires_at: d2.expires_at, model: MODEL, variant }); return; }
      }
    } catch (e) {
      lastMsg = String(e && e.message || e);
    }
  }
  res.status(502).json({ error: "provider_error", message: "Não consegui abrir a sessão de voz: " + lastMsg });
};
