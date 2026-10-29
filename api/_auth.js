// Shared access check for every API route (files starting with "_" are not exposed as routes by Vercel).
// Accepts either the x-app-code header or the long-lived "tec_auth" cookie set by /api/login.
// The code is compared ignoring case and spaces, so a phone keyboard that capitalizes the first letter still works.
const crypto = require("crypto");

const COOKIE = "tec_auth";
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

function expectedCode() { return process.env.APP_PASSWORD || ""; }

// The cookie holds a signature derived from the code, never the code itself.
function token() { return crypto.createHmac("sha256", norm(expectedCode())).update("tech-english-coach:v1").digest("base64url"); }

function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return "";
}

function codeMatches(code) { return !!expectedCode() && sameText(norm(code), norm(expectedCode())); }

function isAuthorized(req) {
  if (!expectedCode()) return false;
  const header = req.headers["x-app-code"];
  if (header && codeMatches(header)) return true;
  const c = readCookie(req, COOKIE);
  return !!c && sameText(c, token());
}

function setAuthCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token()}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
}

// Returns true when the request may go on; otherwise it has already answered.
function guard(req, res) {
  if (!expectedCode()) { res.status(500).json({ error: "no_password", message: "APP_PASSWORD não está configurada na Vercel. Defina um código de acesso antes de usar." }); return false; }
  if (!isAuthorized(req)) { res.status(401).json({ error: "bad_code", message: "Código de acesso inválido." }); return false; }
  return true;
}

module.exports = { guard, isAuthorized, codeMatches, setAuthCookie, expectedCode };
