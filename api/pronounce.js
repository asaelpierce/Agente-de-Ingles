// POST { text } -> pronunciation for a Brazilian learner (General American): per word IPA, syllables with stress,
// Portuguese-style respelling with the sounds Portuguese lacks tagged, hardest words, linking, and tips.
// The respelling is built by rules from dictionary phonemes (lib/pron/engine.js), never written by the AI.
// Only words missing from the dictionary are estimated by the AI, in validated ARPAbet, and flagged "estimated".
const { guard } = require("../lib/auth");
const { analyze, validArpabet, ARPABET_SYMBOLS } = require("../lib/pron/engine");
const { chatJSON } = require("../lib/openai");

const estimates = new Map(); // warm-instance memo: word -> ARPAbet | null

async function estimate(words) {
  const todo = [...new Set(words.map(w => w.toLowerCase()))].filter(w => !estimates.has(w)).slice(0, 12);
  if (todo.length && process.env.OPENAI_API_KEY) {
    try {
      const d = await chatJSON({
        system: `You are a phonetician. Give the General American (US) pronunciation of each word in ARPAbet exactly as CMUdict writes it: phonemes separated by spaces, a stress digit (0, 1 or 2) on every vowel, primary stress 1 on exactly one vowel. Allowed symbols only: ${ARPABET_SYMBOLS.join(" ")}. Brand and product names: the way English-speaking engineers say them. If a word is not English (e.g. a Portuguese name) or you are not sure how Americans say it, use null. Never guess wildly. Reply with ONLY JSON: {"word": "ARPABET or null", ...}`,
        user: JSON.stringify(todo), maxTokens: 600
      });
      for (const w of todo) { const a = d && typeof d[w] === "string" ? d[w].toUpperCase().trim() : null; estimates.set(w, a && validArpabet(a) ? a : null); }
    } catch (e) { /* leave them missing: the page then offers only the native audio for those words */ }
  }
  const out = {}; for (const w of words) { const a = estimates.get(w.toLowerCase()); if (a) out[w.toLowerCase()] = a; }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  if (!guard(req, res)) return;
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const text = String((body && body.text) || "").slice(0, 600).trim();
  if (!text) { res.status(400).json({ error: "bad_request", message: "Texto vazio." }); return; }
  try {
    let r = analyze(text);
    if (r.missing.length) { const est = await estimate(r.missing); if (Object.keys(est).length) r = analyze(text, est); }
    res.status(200).json(r);
  } catch (e) {
    res.status(500).json({ error: "server_error", message: "Erro ao montar a pronúncia: " + String((e && e.message) || e) });
  }
};
