// Not present in the pasted source — written to match the schema, config and session
// modules already in the project (OAuth-only accounts; users has no password column).
import { Router } from 'express';
import { cfg } from '../config.js';
import { db } from '../db.js';
import { seal } from '../crypto.js';
import { issue, clear } from '../session.js';
import { pub } from '../redis.js';
import { randomState } from '../crypto.js';

export const auth = Router();

const STATE_COOKIE = 'sl_state';
const setState = (res, state) => res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/' });

const handleFrom = (name, fallback) =>
  (name || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || fallback;

async function uniqueHandle(base) {
  let handle = base, n = 0;
  while (await db.one('select 1 from users where handle = $1', [handle])) handle = `${base}${++n}`;
  return handle;
}

async function findOrCreateUser({ email, name, avatar }) {
  let user = await db.one('select * from users where email = $1', [email]);
  if (!user) {
    const handle = await uniqueHandle(handleFrom(name, email.split('@')[0]));
    user = await db.one(
      `insert into users (email, handle, display_name, avatar_url) values ($1,$2,$3,$4) returning *`,
      [email, handle, name || handle, avatar || null],
    );
  }
  return user;
}

// ---- Spotify ----
const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

auth.get('/spotify', (req, res) => {
  const state = randomState();
  setState(res, state);
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.spotify.id,
    scope: SPOTIFY_SCOPES,
    redirect_uri: cfg.spotify.redirect,
    state,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${qs}`);
});

auth.get('/spotify/callback', async (req, res, next) => {
  try {
    if (!req.query.code || req.query.state !== req.cookies?.[STATE_COOKIE]) {
      return res.status(400).send('Invalid or expired login attempt, please try again.');
    }
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${cfg.spotify.id}:${cfg.spotify.secret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: cfg.spotify.redirect,
      }),
    });
    if (!tokenRes.ok) throw Object.assign(new Error('spotify_token_exchange_failed'), { status: 400 });
    const t = await tokenRes.json();

    const profRes = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!profRes.ok) throw Object.assign(new Error('spotify_profile_failed'), { status: 400 });
       const p = await profRes.json();
    // Some Spotify accounts don't expose an email (Facebook/Apple sign-up, privacy
    // settings). Fall back to a stable placeholder instead of blocking sign-in.
    const email = p.email || `spotify-${p.id}@sonic-ledger.local`;

    // If this browser already has a session (e.g. signed in with Google first), link
    // Spotify to that same account instead of creating a separate one.
    const user = req.user || await findOrCreateUser({ email, name: p.display_name, avatar: p.images?.[0]?.url });

    const link = await db.one(
      `insert into platform_links (user_id, platform, access_token, refresh_token, scopes, expires_at, state, last_poll_at)
       values ($1,'spotify',$2,$3,$4, now() + ($5 || ' seconds')::interval, 'active', now())
       on conflict (user_id, platform) do update set
         access_token = excluded.access_token,
         refresh_token = coalesce(excluded.refresh_token, platform_links.refresh_token),
         scopes = excluded.scopes, expires_at = excluded.expires_at, state = 'active'
       returning *`,
      [user.id, seal(t.access_token), seal(t.refresh_token), SPOTIFY_SCOPES, String(t.expires_in)],
    );

    // FIX (#2): tell the poller to start this link now instead of waiting for its 30s sweep.
    await pub.publish('link:new', JSON.stringify({ linkId: link.id })).catch(() => {});

    issue(res, user.id);
    res.redirect(cfg.webOrigin);
  } catch (e) { next(e); }
});

// ---- Google (identity only — used for sign-in when a friend prefers it; music data still
// comes through Spotify or the YouTube Music Takeout import route, not through this login) ----
auth.get('/google', (req, res) => {
  const state = randomState();
  setState(res, state);
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.google.id,
    scope: 'openid email profile',
    redirect_uri: cfg.google.redirect,
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${qs}`);
});

auth.get('/google/callback', async (req, res, next) => {
  try {
    if (!req.query.code || req.query.state !== req.cookies?.[STATE_COOKIE]) {
      return res.status(400).send('Invalid or expired login attempt, please try again.');
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: cfg.google.redirect,
        client_id: cfg.google.id,
        client_secret: cfg.google.secret,
      }),
    });
    if (!tokenRes.ok) throw Object.assign(new Error('google_token_exchange_failed'), { status: 400 });
    const t = await tokenRes.json();

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!infoRes.ok) throw Object.assign(new Error('google_userinfo_failed'), { status: 400 });
    const p = await infoRes.json();

    const user = await findOrCreateUser({ email: p.email, name: p.name, avatar: p.picture });
    issue(res, user.id);
    res.redirect(cfg.webOrigin);
  } catch (e) { next(e); }
});

auth.post('/logout', (req, res) => { clear(res); res.json({ ok: true }); });
