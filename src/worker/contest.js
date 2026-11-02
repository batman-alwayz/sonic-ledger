import { db } from '../db.js';
import { connectRedis, pub } from '../redis.js';

async function closeWeek() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const start = new Date(d.getTime() - 7 * 864e5);

  const winner = await db.one(
    `select p.user_id, sum(p.ms_played)/60000.0 m
       from plays p
      where p.played_at >= $1 and p.played_at < $2
      group by p.user_id order by m desc limit 1`,
    [start, d],
  );

  await db.query(
    `insert into contests (week_start, winner_id, closed_at)
     values ($1,$2, now())
     on conflict (week_start) do update set winner_id = excluded.winner_id, closed_at = now()`,
    [start, winner?.user_id ?? null],
  );

  if (winner) {
    await pub.publish('contest', JSON.stringify({ weekStart: start, winnerId: winner.user_id, minutes: Number(winner.m) }));
  }
  console.log('closed week', start.toISOString(), 'winner', winner?.user_id ?? 'none');
}

await connectRedis();
await closeWeek();
process.exit(0);
