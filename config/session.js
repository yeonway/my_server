const SESSION_COOKIE_NAME = 'session_token';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function buildCookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  const parsed = parseInt(process.env.SESSION_COOKIE_MAX_AGE_MS || '', 10);
  const maxAge = Number.isNaN(parsed) ? DEFAULT_MAX_AGE_MS : parsed;
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge,
    path: '/',
  };
}

function readSessionToken(req) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (!item) continue;
    const eqIndex = item.indexOf('=');
    if (eqIndex === -1) continue;
    const key = item.substring(0, eqIndex);
    if (key !== SESSION_COOKIE_NAME) continue;
    const value = item.substring(eqIndex + 1);
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }
  return null;
}

function attachSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, buildCookieOptions());
}

function clearSessionCookie(res) {
  const opts = buildCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, { ...opts, maxAge: undefined });
}

module.exports = {
  SESSION_COOKIE_NAME,
  buildCookieOptions,
  readSessionToken,
  attachSessionCookie,
  clearSessionCookie,
};
