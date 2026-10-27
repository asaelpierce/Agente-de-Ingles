// Vercel serverless function: speech-to-text with OpenAI (much better with a Brazilian accent than the browser's recognizer).
// Body (JSON): { audio: base64 string, mime: "audio/webm" | "audio/mp4" | ..., language?: "en", prompt?: string }
// Env vars: OPENAI_API_KEY, APP_PASSWORD, OPENAI_TRANSCRIBE_MODEL (default gpt-transcribe).

const PREFERRED = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";
const MODELS = [PREFERRED, "gpt-transcribe", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"].filter((m, i, a) => a.indexOf(m) === i);
const BASE_PROMPT = "A Brazilian IT professional practicing English. Tech terms: deploy, bug, API, server, database, pull request, merge, commit, ticket, sprint, standup, backend, frontend, cloud, pipeline, automation.";

function readBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  return body || {};
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: "no_api_key", message: "OPENAI_API_KEY não está configurada na Vercel." }); return; }
  const expected = process.env.APP_PASSWORD;
  if (!expected) { res.status(500).json({ error: "no_password" }); return; }
  if ((req.headers["x-app-code"] || "") !== expected) { res.status(401).json({ error: "bad_code", message: "Código de acesso inválido." }); return; }

  const body = readBody(req);
  if (typeof body.audio !== "string" || !body.audio) { res.status(400).json({ error: "bad_request", message: "Áudio ausente." }); return; }
  const buf = Buffer.from(body.audio, "base64");
  if (buf.length < 800) { res.status(200).json({ text: "" }); return; } // too short to hold speech
  if (buf.length > 3 * 1024 * 1024) { res.status(413).json({ error: "too_large", message: "Áudio muito longo." }); return; }
  const mime = /^audio\/[a-z0-9.+-]+/i.test(body.mime || "") ? String(body.mime).split(";")[0] : "audio/webm";
  const ext = mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
  const prompt = (BASE_PROMPT + " " + String(body.prompt || "")).slice(0, 800);

  let lastMsg = "";
  for (const model of MODELS) {
    try {
      const form = new FormData();
      form.append("file", new Blob([buf], { type: mime }), "speech." + ext);
      form.append("model", model);
      form.append("prompt", prompt);
      if (body.language === "en" || body.language === "pt") form.append("language", body.language);
      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + key }, body: form });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { res.status(200).json({ text: String(data.text || "").trim(), model }); return; }
      lastMsg = (data && data.error && data.error.message) || ("HTTP " + r.status);
      if (r.status === 401 || r.status === 403 || r.status === 429) break;
      if (!/model|not found|does not exist|unsupported/i.test(lastMsg) && r.status !== 404) break; // not a model-name issue
    } catch (e) { lastMsg = String(e && e.message || e); }
  }
  res.status(502).json({ error: "provider_error", message: "Falha na transcrição: " + lastMsg });
};
