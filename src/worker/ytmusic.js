/**
 * ============================= DO NOT ENABLE =============================
 * This file is kept only as a reference for what an InnerTube client would
 * look like. It authenticates with a scraped SAPISID session cookie and
 * calls Google's private, undocumented music.youtube.com API. That is a
 * Google Terms of Service violation and risks the *user's* Google account
 * being flagged, not just this app. It is never imported anywhere in
 * index.js, poller.js or routes/import.js — the only YouTube Music path
 * wired into the app is routes/import.js, which reads an official Google
 * Takeout export the user downloads themselves. Leave it that way.
 * ===========================================================================
 */
import { createHash } from 'node:crypto';

export function sapiHash(sapisid, origin = 'https://music.youtube.com') {
  const ts = Math.floor(Date.now() / 1000);
  const h = createHash('sha1').update(`${ts} ${sapisid} ${origin}`).digest('hex');
  return `SAPISIDHASH ${ts}_${h}`;
}

export const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

export async function nowPlaying(cookie) {
  const res = await fetch(`https://music.youtube.com/youtubei/v1/browse?key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: sapiHash(cookie.sapisid),
      Cookie: `SAPISID=${cookie.sapisid}; __Secure-3PAPISID=${cookie.sapisid}`,
      Origin: 'https://music.youtube.com',
      'X-Goog-AuthUser': '0',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00' } },
      browseId: 'FEmusic_now_playing',
    }),
  });
  if (!res.ok) throw new Error('innertube_' + res.status);
  const j = await res.json();
  const panel = j?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
    ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
    ?.musicCarouselShelfRenderer?.contents?.[0]?.musicTwoRowItemRenderer;
  if (!panel) return null;
  return {
    title: panel.title?.runs?.[0]?.text,
    artist: panel.subtitle?.runs?.[0]?.text,
    videoId: panel.navigationEndpoint?.watchEndpoint?.videoId,
  };
}
