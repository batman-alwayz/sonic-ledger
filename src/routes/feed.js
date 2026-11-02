import { Router } from 'express';
import { db } from '../db.js';
import { requireUser } from '../session.js';

export const feed = Router();
feed.use(requireUser);

feed.get('/', async (req, res) => {
  const before = req.query.before ? new Date(String(req.query.before)) : new Date();
  const rows = await db.many(
    `select p.id, p.played_at, t.title, t.artist, t.album, u.handle, u.display_name, u.avatar_url
       from plays p
       join tracks t on t.id = p.track_id
       join users u on u.id = p.user_id
      where p.played_at < $2
        and (p.user_id = $1 or p.user_id in (
              select followee_id from follows where follower_id = $1 and status = 'accepted'))
      order by p.played_at desc limit 40`,
    [req.user.id, before],
  );
  res.json(rows);
});
