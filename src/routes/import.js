import { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { requireUser } from '../session.js';

export const importer = Router();
importer.use(requireUser);

const entry = z.object({
  title: z.string().min(1),
  artist: z.string().default('unknown'),
  playedAt: z.string().datetime(),
  msPlayed: z.number().int().positive().max(3_600_000).default(210_000),
});

const payload = z.object({ entries: z.array(entry).max(50_000) });

const ytId = (t, a) => 'yt_' + createHash('sha1').update(t + a).digest('hex').slice(0, 16);

importer.post('/ytmusic', async (req, res) => {
  const { entries } = payload.parse(req.body);

  const result = await db.tx(async (c) => {
    let added = 0;
    for (const e of entries) {
      const id = ytId(e.title, e.artist);
      const playedAt = new Date(e.playedAt);
      const bucket = Math.floor(playedAt.getTime() / 10_000);

      await c.query(
        `insert into tracks (id, platform, title, artist, duration_ms)
         values ($1,'ytmusic',$2,$3,$4) on conflict (id) do nothing`,
        [id, e.title, e.artist, e.msPlayed],
      );
      const r = await c.query(
        `insert into plays (user_id, platform, track_id, played_at, ms_played, bucket)
         values ($1,'ytmusic',$2,$3,$4,$5) on conflict do nothing`,
        [req.user.id, id, playedAt, e.msPlayed, bucket],
      );
      added += r.rowCount;
    }
    return added;
  });

  res.json({ added: result, received: entries.length });
});
