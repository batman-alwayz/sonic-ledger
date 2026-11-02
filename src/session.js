import jwt from 'jsonwebtoken';
import { cfg } from './config.js';
import { db } from './db.js';

const COOKIE = 'sl_sid';

export function issue(res, userId) {
  const token = jwt.sign({ uid: userId }, cfg.jwt, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.publicUrl.startsWith('https'),
    maxAge: 30 * 864e5,
    path: '/',
  });
}

export const clear = (res) => res.clearCookie(COOKIE, { path: '/' });

export async function attach(req, _res, next) {
  const raw = req.cookies?.[COOKIE];
  if (raw) {
    try {
      const { uid } = jwt.verify(raw, cfg.jwt);
      req.user = await db.one('select id, email, handle, display_name, avatar_url from users where id = $1', [uid]);
    } catch {}
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}
