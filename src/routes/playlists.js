import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../session.js';
import * as sp from '../spotify.js';
import * as a from '../analytics.js';

export const playlists = Router();
playlists.use(requireUser);

const body = z.object({
  source: z.enum(['top', 'blend', 'blast', 'gems', 'time']),
  name: z.string().min(1).max(120),
  public: z.boolean().default(false),
  window: z.enum(['7d', '4w', '6m', '1y', 'all']).default('4w'),
  with: z.array(z.string().uuid()).max(5).default([]),
});

async function candidates(userId, b) {
  switch (b.source) {
    case 'top': return a.topTracks(userId, b.window, 40);
    case 'blend': {
      const ids = [userId, ...b.with];
      const rows = await db.many(
        `select t.id, t.title, t.artist from tracks t where t.artist in (
           select artist from (
             select t2.artist, sum(p.ms_played) m from plays p join tracks t2 on t2.id = p.track_id
              where p.user_id = any($1) and p.played_at >= now() - interval '28 days'
              group by t2.artist order by m desc limit 12) x)
         order by random() limit 40`,
        [ids],
      );
      return rows;
    }
    case 'blast': {
      return db.many(
        `select t.id, t.title, t.artist from tracks t
          where t.artist in (
            select t2.artist from plays p join tracks t2 on t2.id = p.track_id
             where p.user_id = $1 and p.played_at < now() - interval '210 days'
               and t2.artist not in (
                 select t3.artist from plays p3 join tracks t3 on t3.id = p3.track_id
                  where p3.user_id = $1 and p3.played_at >= now() - interval '60 days')
             group by t2.artist order by count(*) desc limit 6)
          limit 40`,
        [userId],
      );
    }
    case 'gems': {
      return db.many(
        `select t.id, t.title, t.artist from tracks t
          where t.artist in (
            select t2.artist from plays p join tracks t2 on t2.id = p.track_id
             where p.user_id = $1 and p.played_at >= now() - interval '182 days'
             group by t2.artist order by sum(p.ms_played) desc limit 8)
          order by (select count(*) from plays p4 where p4.track_id = t.id and p4.user_id = $1) asc
          limit 40`,
        [userId],
      );
    }
    case 'time': {
      return db.many(
        `select t.id, t.title, t.artist, count(*) c from plays p join tracks t on t.id = p.track_id
          where p.user_id = $1 and p.played_at between now() - interval '545 days' and now() - interval '180 days'
          group by t.id order by c desc limit 30`,
        [userId],
      );
    }
    default: return [];
  }
}

playlists.post('/', async (req, res) => {
  const b = body.parse(req.body);
  const link = await db.one(`select * from platform_links where user_id = $1 and platform = 'spotify'`, [req.user.id]);
  if (!link) return res.status(400).json({ error: 'spotify not linked' });

  const profile = await sp.me(link);
  if (!profile) return res.status(400).json({ error: 'spotify profile unavailable' });

  const items = await candidates(req.user.id, b);
  const pl = await sp.createPlaylist(link, profile.id, b.name, 'Built from sonic ledger', b.public);

  const uris = [];
  let skipped = 0;

  for (const t of items) {
    if (/^[A-Za-z0-9]{22}$/.test(t.id) && !t.id.startsWith('yt_')) {
      uris.push(`spotify:track:${t.id}`);
      continue;
    }
    const r = await sp.searchTrack(link, t.title, t.artist);
    if (!r.ok) { skipped++; continue; }
    const j = await r.json();
    const hit = j.tracks?.items?.[0];
    if (hit) uris.push(hit.uri); else skipped++;
    await new Promise((r2) => setTimeout(r2, 120));
  }

  for (let i = 0; i < uris.length; i += 100) {
    await sp.addTracks(link, pl.id, uris.slice(i, i + 100));
  }

  await db.query(
    `insert into playlist_exports (user_id, source, spotify_id, name, track_count, skipped, url)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [req.user.id, b.source, pl.id, b.name, uris.length, skipped, pl.external_urls?.spotify ?? null],
  );

  res.json({ url: pl.external_urls?.spotify, added: uris.length, skipped });
});
