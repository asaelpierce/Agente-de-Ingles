// Vercel serverless function: natural English voice via OpenAI text-to-speech.
// Env vars: OPENAI_API_KEY (required for this route), OPENAI_TTS_MODEL (default gpt-4o-mini-tts),
//           OPENAI_TTS_VOICE (default "nova"), APP_PASSWORD.
// Without OPENAI_API_KEY the route answers 404 and the page falls back to the browser's own voice.

const { guard } = require("./_auth");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(404).json({ error: "tts_unavailable" }); return; }
  if (!guard(req, res)) return;

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const text = body && typeof body.text === "string" ? body.text.trim().slice(0, 1200) : "";
  if (!text) { res.status(400).json({ error: "bad_request" }); return; }
  const speed = Math.min(1.5, Math.max(0.5, Number(body.speed) || 1));

  try {
    const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    const payload = { model, voice: process.env.OPENAI_TTS_VOICE || "nova", input: text, response_format: "mp3" };
    if (model.startsWith("gpt-4o")) {
      // gpt-4o-mini-tts takes natural-language instructions (and ignores "speed"); tts-1 takes "speed" only
      const pace = speed < 0.9 ? "Speak slowly, with clear pauses between phrases." : speed > 1.02 ? "Speak at a brisk, natural pace." : "Speak at a calm, natural pace.";
      payload.instructions = "You are a friendly American English teacher. Clear consonants, no mumbling. " + pace;
    } else {
      payload.speed = speed;
    }
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + key },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      res.status(r.status).json({ error: "provider_error", message: (data && data.error && data.error.message) || "Erro no TTS." });
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).json({ error: "upstream", message: String(e && e.message || e) });
  }
};
