// POST { code }  -> checks the access code; on success sets a 1-year HttpOnly cookie so this device stays signed in.
// GET            -> { ok: true } when this device is already signed in (cookie or header).
const { codeMatches, setAuthCookie, isAuthorized, expectedCode } = require("./_auth");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!expectedCode()) { res.status(500).json({ ok: false, error: "no_password", message: "APP_PASSWORD não está configurada na Vercel." }); return; }
  if (req.method === "GET") {
    const ok = isAuthorized(req);
    if (ok) setAuthCookie(res); // refresh the year on every visit
    res.status(200).json({ ok });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const code = body && body.code;
  if (!code || !codeMatches(code)) {
    await new Promise(r => setTimeout(r, 400)); // slow down guessing a little
    res.status(401).json({ ok: false, error: "bad_code", message: "Código incorreto. Confira e tente de novo." });
    return;
  }
  setAuthCookie(res);
  res.status(200).json({ ok: true });
};
