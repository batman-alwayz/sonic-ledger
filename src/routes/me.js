import { Router } from 'express';
import * as a from '../analytics.js';
import { db } from '../db.js';
import { requireUser } from '../session.js';
import { z } from 'zod';

export const me = Router();
me.use(requireUser);

me.get('/', (req, res) => res.json({ user: req.user }));

me.get('/stats', async (req, res) => {
  const w = z.enum(['7d', '4w', '6m', '1y', 'all']).catch('4w').parse(req.query.window);
  const uid = req.user.id;
  const [summary, artists, tracks, albums, clock, decades, radar, vel, split, obs] = await Promise.all([
    a.summary(uid, w), a.topArtists(uid, w), a.topTracks(uid, w), a.topAlbums(uid, w),
    a.clock(uid, w), a.decades(uid, w), a.radar(uid, w), a.velocity(uid),
    a.platformSplit(uid, w), a.obsession(uid),
  ]);
  res.json({ window: w, summary, artists, tracks, albums, clock, decades, radar, velocity: vel, split, obsession: obs });
});

me.get('/export', async (req, res) => {
  const rows = await db.many(
    `select platform, track_id, played_at, ms_played, device
       from plays where user_id = $1 order by played_at`,
    [req.user.id],
  );
  res.setHeader('Content-Disposition', 'attachment; filename="sonic-ledger.json"');
  res.json({ exportedAt: new Date().toISOString(), plays: rows });
});

me.delete('/links/:platform', async (req, res) => {
  await db.query('delete from platform_links where user_id = $1 and platform = $2', [
    req.user.id, req.params.platform,
  ]);
  res.json({ ok: true });
});
