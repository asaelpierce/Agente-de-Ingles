// Small OpenAI helpers shared by the pronunciation routes.
const SMART = process.env.OPENAI_MODEL || "gpt-6-astra";
const FALLBACKS = ["gpt-5.4-mini", "gpt-4.1-mini"];

async function chatJSON({ system, user, maxTokens = 800, reasoning = "low" }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY ausente");
  const models = [SMART].concat(FALLBACKS).filter((m, i, a) => a.indexOf(m) === i);
  let lastErr = "";
  for (const model of models) {
    let payload = { model, max_completion_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    if (/^(gpt-5|gpt-6|o\d)/.test(model) && reasoning) payload.reasoning_effort = reasoning;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return parseJSON((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "");
      lastErr = (data.error && data.error.message) || "HTTP " + r.status;
      if (r.status === 400 && /reasoning_effort/i.test(lastErr) && payload.reasoning_effort) { payload = Object.assign({}, payload); delete payload.reasoning_effort; continue; }
      if (r.status === 400 && /response_format/i.test(lastErr) && payload.response_format) { payload = Object.assign({}, payload); delete payload.response_format; continue; }
      break;
    }
    if (!/model|not found|does not exist/i.test(lastErr)) break;
  }
  throw new Error(lastErr);
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/); if (m) { try { return JSON.parse(m[1]); } catch (e) {} }
  const a = String(text).indexOf("{"), b = String(text).lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(String(text).slice(a, b + 1)); } catch (e) {} }
  return null;
}

module.exports = { chatJSON, parseJSON };
