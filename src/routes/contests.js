import { Router } from 'express';
import { db } from '../db.js';
import { requireUser } from '../session.js';

export const contests = Router();
contests.use(requireUser);

const weekStart = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
};

contests.get('/current', async (req, res) => {
  const start = weekStart();
  const rows = await db.many(
    `select u.id, u.handle, u.display_name, u.avatar_url,
            coalesce(sum(p.ms_played)/60000.0, 0) as minutes
       from users u
       left join plays p on p.user_id = u.id and p.played_at >= $1
      where u.id = $2
         or u.id in (select followee_id from follows where follower_id = $2 and status = 'accepted')
      group by u.id order by minutes desc`,
    [start, req.user.id],
  );
  res.json({ weekStart: start.toISOString(), board: rows });
});

contests.get('/history', async (req, res) => {
  const rows = await db.many(
    `select c.week_start, u.handle, u.display_name, u.avatar_url
       from contests c left join users u on u.id = c.winner_id
      where c.closed_at is not null order by c.week_start desc limit 20`,
  );
  res.json(rows);
});
