import { cfg } from './config.js';
import { db } from './db.js';
import { open, seal } from './crypto.js';
import { take } from './redis.js';

const API = 'https://api.spotify.com/v1';

async function raw(path, link, opts = {}) {
  if (!(await take(`sp:${link.user_id}`))) {
    const e = new Error('rate_limited');
    e.status = 429;
    throw e;
  }
  const token = await accessToken(link);
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  return res;
}

export async function accessToken(link) {
  const exp = link.expires_at ? new Date(link.expires_at).getTime() : 0;
  if (exp - Date.now() > 60_000) return open(link.access_token);

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${cfg.spotify.id}:${cfg.spotify.secret}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: open(link.refresh_token),
    }),
  });

  if (!res.ok) throw Object.assign(new Error('refresh_failed'), { status: 401 });
  const j = await res.json();

  await db.query(
    `update platform_links
        set access_token = $2,
            expires_at = now() + ($3 || ' seconds')::interval
      where id = $1`,
    [link.id, seal(j.access_token), String(j.expires_in)],
  );

  link.access_token = seal(j.access_token);
  link.expires_at = new Date(Date.now() + j.expires_in * 1000);
  return j.access_token;
}

export const player = (link) => raw('/me/player', link);
export const recentlyPlayed = (link, limit = 50) =>
  raw(`/me/player/recently-played?limit=${limit}`, link);
export const searchTrack = (link, title, artist) =>
  raw(`/search?q=${encodeURIComponent(`track:"${title}" artist:"${artist}"`)}&type=track&limit=1`, link);

export async function me(link) {
  const r = await raw('/me', link);
  if (!r.ok) return null;
  return r.json();
}

export async function createPlaylist(link, userId, name, description, isPublic) {
  const r = await raw(`/users/${userId}/playlists`, link, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, public: isPublic }),
  });
  if (!r.ok) throw Object.assign(new Error('create_failed'), { status: r.status });
  return r.json();
}

export async function addTracks(link, playlistId, uris) {
  const r = await raw(`/playlists/${playlistId}/tracks`, link, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris }),
  });
  if (!r.ok) throw Object.assign(new Error('add_failed'), { status: r.status });
  return r.json();
}

// Restricted for apps created after 2024-11-27; callers should expect [] and degrade gracefully.
export async function audioFeatures(link, ids) {
  const r = await raw(`/audio-features?ids=${ids.join(',')}`, link);
  if (!r.ok) return [];
  const j = await r.json();
  return j.audio_features?.filter(Boolean) ?? [];
}
