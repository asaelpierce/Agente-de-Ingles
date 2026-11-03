// POST { text, audio (base64 WAV, 16 kHz mono) } -> assessment of the learner's pronunciation against the reference.
//
// Two independent signals, so the result does not rest on text similarity alone:
//  1. Phonemes and stress: an audio model listens to the recording itself and compares it, word by word,
//     with the reference IPA from the pronunciation engine (it must first transcribe what it actually heard).
//  2. Intelligibility: a speech-to-text model WITHOUT the reference text (so it cannot "hear what it expects")
//     transcribes the recording; we measure how many reference words a listener would have understood.
// Explanations come from the engine's fixed tips, not from the model.
const { guard } = require("../lib/auth");
const { analyze, spokenWords, TIPS } = require("../lib/pron/engine");

const AUDIO_MODEL = process.env.OPENAI_AUDIO_MODEL || "gpt-audio-1.5";
const TRANSCRIBE = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const a = String(text).indexOf("{"), b = String(text).lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(String(text).slice(a, b + 1)); } catch (e) {} }
  return null;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

async function transcribe(key, wav) {
  for (const model of [TRANSCRIBE, "gpt-4o-transcribe", "whisper-1"].filter((m, i, a) => a.indexOf(m) === i)) {
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
    form.append("model", model);
    form.append("language", "en");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + key }, body: form });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return String(d.text || "").trim();
    const msg = (d.error && d.error.message) || "";
    if (!(r.status === 404 || /model/i.test(msg))) break;
  }
  return null;
}

// Map a reference phoneme the learner missed to one of the engine's tips.
function tipFor(expected, heard, type) {
  const clean = (x) => String(x || "").replace(/[\/\[\]ˈˌ]/g, "").trim();
  const e = clean(expected), h = clean(heard);
  if (type === "insertion" && /[iɪəɨ]$/.test(h)) return TIPS.fin; // "bugi", "fixi": extra vowel after a consonant
  if (type === "insertion" && /^[iɪ]/.test(h)) return TIPS.sC;      // "iscul": extra vowel before s + consonant
  if (type === "deletion" && e && !/[aeiouæɑɔəɛɪʊʌɝɚ]/.test(e)) return "Faltou o som /" + e + "/: não engula as consoantes, principalmente no fim da palavra. Elas mudam o sentido (fix × fixed, work × worked).";
  if (e === "θ" || e === "ð" || e === "ɹ" || e === "æ" || e === "ɪ" || e === "ʊ" || e === "ʌ" || e === "h" || e === "ŋ" || e === "ɝ" || e === "ɚ" || e === "ɾ") return TIPS[e];
  if (e === "l" || e === "ɫ") return TIPS["ɫ"];
  if ((e === "t" || e === "d") && /tʃ|dʒ/.test(h)) return TIPS.td;
  if (type === "stress") return "Tônica: a sílaba em MAIÚSCULAS precisa ser mais forte, mais longa e mais alta que as outras.";
  return "";
}

async function listen(key, wav64, ref) {
  const refList = ref.words.map((w, i) => w.ipa ? `${i}. ${w.w || "(número)"} /${w.ipa}/${w.weak ? " (forma fraca)" : ""}` : `${i}. ${w.w} (sem referência)`).join("\n");
  const system = `You are an expert phonetician assessing a Brazilian learner reading an English sentence. Target accent: General American. Natural connected speech (weak forms, flapped t, linking) is correct, AND careful clear speech (full forms of small words, an unflapped t, no linking) is ALSO correct: never mark a word down for being said clearly.
Step 1 - listen first: write "heard_ipa", a narrow IPA transcription of what the speaker ACTUALLY said, including typical Brazilian features you really hear (e.g. [t]/[f]/[s] for θ, [d]/[z] for ð, [h] or [ɾ] for ɹ, an extra [i] after final consonants or before s+consonant, [w] for final l, nasalized vowels, [tʃ]/[dʒ] before i, [ɛ] for æ, [i] for ɪ). Do not copy the reference; if you hear the reference, write it.
Step 2 - compare word by word with the reference. Report only problems you can clearly hear; never invent problems; ignore accent features that do not change the sound in a way a listener would notice. If the audio is silent, cut or unclear, set "audio_ok": false.
Statuses: "ok" (native-like or fully clear), "close" (understandable, small sound issue), "wrong" (a sound or stress that makes it hard to understand or changes the word), "missing" (not said).
Reply with ONLY JSON:
{"audio_ok": true, "heard_ipa": "...", "words": [{"i": 0, "status": "ok|close|wrong|missing", "heard": "IPA of how this word was said", "issues": [{"expected": "one phoneme from that word's reference IPA, or the stressed syllable for stress problems", "heard": "what was produced", "type": "substitution|insertion|deletion|stress"}]}], "stress_ok": true, "intelligibility": 0, "summary_pt": "one short encouraging sentence in Brazilian Portuguese naming the single most important thing to improve"}`;
  const user = `Reference sentence: "${ref.text}"\nReference IPA (General American): ${ref.ipa}\nWords:\n${refList}`;
  const body = (modalities) => JSON.stringify(Object.assign({
    model: AUDIO_MODEL, modalities,
    messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text: user }, { type: "input_audio", input_audio: { data: wav64, format: "wav" } }] }]
  }, modalities.includes("audio") ? { audio: { voice: "alloy", format: "wav" } } : {}));
  let r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: body(["text"]) });
  let d = await r.json().catch(() => ({}));
  if (!r.ok && /modalit/i.test((d.error && d.error.message) || "")) {
    r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: body(["text", "audio"]) });
    d = await r.json().catch(() => ({}));
  }
  if (!r.ok) throw new Error((d.error && d.error.message) || "HTTP " + r.status);
  const msg = d.choices && d.choices[0] && d.choices[0].message;
  const text = (msg && (msg.content || (msg.audio && msg.audio.transcript))) || "";
  return parseJSON(text);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: "no_api_key", message: "OPENAI_API_KEY não está configurada na Vercel." }); return; }
  if (!guard(req, res)) return;
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  let text = String((body && body.text) || "").trim();
  if (text.length > 300) text = text.slice(0, 300).replace(/\s+\S*$/, "");
  const wav64 = String((body && body.audio) || "");
  if (!text || !wav64) { res.status(400).json({ error: "bad_request", message: "Faltou a frase ou o áudio." }); return; }
  const wav = Buffer.from(wav64, "base64");
  if (wav.length < 8000) { res.status(200).json({ ok: false, reason: "short", message: "Não ouvi nada. Fale mais perto do microfone." }); return; }
  if (wav.length > 3 * 1024 * 1024) { res.status(413).json({ error: "too_large", message: "Áudio muito longo: grave só a frase." }); return; }

  const ref = analyze(text);
  const [heardText, judged] = await Promise.all([
    transcribe(key, wav).catch(() => null),
    listen(key, wav64, ref).catch((e) => ({ _error: String((e && e.message) || e) }))
  ]);

  // intelligibility from the reference-free transcript: share of reference words a listener got
  // both sides in spoken form (contractions, numbers, hyphens), compared in order (longest common subsequence)
  const refWords = spokenWords(text).map(norm).filter(Boolean);
  let understood = null;
  if (heardText !== null) {
    const got = spokenWords(heardText).map(norm).filter(Boolean);
    const dp = Array.from({ length: refWords.length + 1 }, () => new Array(got.length + 1).fill(0));
    for (let a = 1; a <= refWords.length; a++) for (let b = 1; b <= got.length; b++) dp[a][b] = refWords[a - 1] === got[b - 1] ? dp[a - 1][b - 1] + 1 : Math.max(dp[a - 1][b], dp[a][b - 1]);
    understood = refWords.length ? dp[refWords.length][got.length] / refWords.length : 0;
  }

  const out = { ok: true, text, ipa: ref.ipa, heard_text: heardText, words: [], mode: "full" };
  let usable = !!(judged && !judged._error && Array.isArray(judged.words) && judged.audio_ok !== false);
  if (!usable) {
    if (judged && judged.audio_ok === false) { res.status(200).json({ ok: false, reason: "audio", message: "O áudio ficou cortado ou baixo. Tente de novo, perto do microfone." }); return; }
    // the phoneme check failed: say so and fall back to intelligibility only
    out.mode = "intelligibility";
    out.note = "A análise dos sons não respondeu agora" + (judged && judged._error ? " (" + judged._error.slice(0, 120) + ")" : "") + "; esta nota mede só se deu para entender.";
  }
  const byIndex = new Map(); if (usable) for (const w of judged.words) if (Number.isInteger(w.i) && ["ok", "close", "wrong", "missing"].includes(w.status)) byIndex.set(w.i, w);
  const judgeable = ref.words.filter(w => w.ipa).length;
  if (usable && byIndex.size < Math.ceil(judgeable / 2)) {
    usable = false; out.mode = "intelligibility";
    out.note = "A análise dos sons veio incompleta; esta nota mede só se deu para entender.";
  }
  let pts = 0, weightSum = 0;
  ref.words.forEach((w, i) => {
    const j = byIndex.get(i) || {};
    const status = usable && byIndex.has(i) ? j.status : null;
    const issues = (usable && Array.isArray(j.issues) ? j.issues : []).slice(0, 3).map(x => ({ expected: String(x.expected || ""), heard: String(x.heard || ""), type: String(x.type || ""), tip: tipFor(x.expected, x.heard, x.type) }));
    out.words.push({ i, w: w.w, ipa: w.ipa || "", status, heard: usable ? String(j.heard || "") : "", issues });
    if (usable && w.ipa && status) { const wt = w.weak ? 0.5 : 1; weightSum += wt; pts += wt * ({ ok: 1, close: 0.65, wrong: 0.2, missing: 0 }[status]); }
  });
  const phon = usable && weightSum ? pts / weightSum : null;
  const rawIntel = usable ? Number(judged.intelligibility) : NaN;
  const modelIntel = Number.isFinite(rawIntel) ? Math.max(0, Math.min(1, rawIntel <= 1 ? rawIntel : rawIntel / 100)) : null;
  const intel = understood !== null && modelIntel !== null ? (understood + modelIntel) / 2 : (understood !== null ? understood : modelIntel);
  out.intelligibility = intel === null ? null : Math.round(intel * 100);
  out.stress_ok = usable && typeof judged.stress_ok === "boolean" ? judged.stress_ok : null;
  out.heard_ipa = usable ? String(judged.heard_ipa || "") : "";
  out.summary_pt = usable ? String(judged.summary_pt || "") : "";
  if (phon !== null) {
    const parts = [[0.5, phon], [0.3, intel], [0.2, out.stress_ok === null ? null : (out.stress_ok ? 1 : 0.6)]].filter(x => x[1] !== null);
    const wsum = parts.reduce((a, x) => a + x[0], 0);
    out.score = Math.round(100 * parts.reduce((a, x) => a + x[0] * x[1], 0) / wsum);
  } else out.score = out.intelligibility;
  if (out.score == null) { res.status(200).json({ ok: false, reason: "unavailable", message: "Não consegui avaliar agora (a análise e a transcrição falharam). Tente de novo em instantes." }); return; }
  res.status(200).json(out);
};
