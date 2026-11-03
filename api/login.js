// POST { code }  -> checks the access code; on success sets a 1-year HttpOnly cookie so this device stays signed in.
// GET            -> { ok: true } when this device is already signed in (cookie or header).
// Every failure answers JSON with a specific error, so the page can tell "wrong code" apart from "server problem".
const { codeMatches, setAuthCookie, isAuthorized, expectedCode } = require("../lib/auth");

function readBody(req) {
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    return body && typeof body === "object" ? body : {};
  } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!expectedCode()) { res.status(500).json({ ok: false, error: "no_password", message: "A variável APP_PASSWORD não está configurada na Vercel (Settings → Environment Variables), ou foi criada depois do último deploy." }); return; }
    if (req.method === "GET") {
      const ok = isAuthorized(req);
      if (ok) setAuthCookie(res); // refresh the year on every visit
      res.status(200).json({ ok });
      return;
    }
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method_not_allowed" }); return; }
    const code = readBody(req).code;
    if (!code || !codeMatches(code)) {
      await new Promise(r => setTimeout(r, 400)); // slow down guessing a little
      res.status(401).json({ ok: false, error: "bad_code", message: "Código incorreto. Ele precisa ser igual ao valor de APP_PASSWORD na Vercel (maiúsculas e espaços não importam)." });
      return;
    }
    setAuthCookie(res);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error", message: "Erro no servidor: " + String((e && e.message) || e) });
  }
};
