import { Router } from 'express';
import { db } from '../db.js';
import { requireUser } from '../session.js';
import * as a from '../analytics.js';

export const friends = Router();
friends.use(requireUser);

friends.get('/', async (req, res) => {
  const rows = await db.many(
    `select u.id, u.handle, u.display_name, u.avatar_url,
            (select sum(ms_played)/60000.0 from plays p
              where p.user_id = u.id and p.played_at >= now() - interval '7 days') as week_minutes
       from follows f join users u on u.id = f.followee_id
      where f.follower_id = $1 and f.status = 'accepted'`,
    [req.user.id],
  );
  res.json(rows);
});

friends.post('/:handle', async (req, res) => {
  const target = await db.one('select id from users where handle = $1', [req.params.handle]);
  if (!target) return res.status(404).json({ error: 'no such user' });
  await db.query(
    `insert into follows (follower_id, followee_id) values ($1,$2) on conflict do nothing`,
    [req.user.id, target.id],
  );
  res.json({ ok: true });
});

friends.delete('/:id', async (req, res) => {
  await db.query('delete from follows where follower_id = $1 and followee_id = $2', [
    req.user.id, req.params.id,
  ]);
  res.json({ ok: true });
});

friends.get('/:id', async (req, res) => {
  const u = await db.one('select id, handle, display_name, avatar_url from users where id = $1', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'not found' });
  const [summary, tracks] = await Promise.all([a.summary(u.id, '4w'), a.topTracks(u.id, '4w', 10)]);
  res.json({ user: u, summary, tracks });
});

friends.get('/:id/compat', async (req, res) => {
  const [ra, rb, shared] = await Promise.all([
    a.radar(req.user.id, '4w'), a.radar(req.params.id, '4w'),
    a.sharedArtists(req.user.id, req.params.id),
  ]);
  const cos = a.cosine(ra, rb);
  const union = await db.one(
    `with ta as (select distinct t.artist from plays p join tracks t on t.id = p.track_id
                  where p.user_id = $1 and p.played_at >= now() - interval '28 days' limit 15),
          tb as (select distinct t.artist from plays p join tracks t on t.id = p.track_id
                  where p.user_id = $2 and p.played_at >= now() - interval '28 days' limit 15)
     select count(*)::float from (select artist from ta union select artist from tb) x`,
    [req.user.id, req.params.id],
  );
  const jac = shared.length / Math.max(1, Number(union.count));
  res.json({
    score: Math.round(Math.max(0, Math.min(100, cos * 55 + jac * 45))),
    drift: Math.round((1 - cos) * 100),
    shared: shared.map((s) => s.artist),
    radar: { you: ra, them: rb },
  });
});
