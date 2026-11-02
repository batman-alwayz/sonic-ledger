import { db } from './db.js';
import { connectRedis } from './redis.js';
import { randomBytes, createHash } from 'node:crypto';

const ARTISTS = ['Nebula Drift','Velvet Arcade','K.O. Static','Marrow Fields','Pale Cassette','Hexa Morass','Blue Danube Nine','Cobalt Vow','Sugar Regime','Ashfall Sonata'];
const WORDS = ['Hollow','Signal','Vermilion','Ghost','Paper','Static','Midnight','Ivory','Radio','Fever'];

await connectRedis();

const uid = async (email, handle, name) =>
  (await db.one(
    `insert into users (email, handle, display_name) values ($1,$2,$3)
     on conflict (email) do update set display_name = excluded.display_name returning id`,
    [email, handle, name],
  )).id;

const me = await uid('me@test.local', 'metest', 'You');
const friend = await uid('friend@test.local', 'friendtest', 'Mara');

await db.query(`insert into follows (follower_id, followee_id) values ($1,$2) on conflict do nothing`, [me, friend]);

let n = 0;
for (const u of [me, friend]) {
  for (let d = 0; d < 120; d++) {
    for (let k = 0; k < 4; k++) {
      const artist = ARTISTS[Math.floor(Math.random() * ARTISTS.length)];
      const title = WORDS[Math.floor(Math.random() * WORDS.length)];
      const id = 'sp_' + createHash('sha1').update(title + artist).digest('hex').slice(0, 16);
      const dur = 180_000 + Math.floor(Math.random() * 200_000);
      await db.query(
        `insert into tracks (id, platform, title, artist, album, duration_ms, decade)
         values ($1,'spotify',$2,$3,'Seeded', $4, 2000) on conflict (id) do nothing`,
        [id, title, artist, dur],
      );
      await db.query(
        `insert into track_features (track_id, energy, danceability, valence, acousticness, instrumentalness)
         values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [id, Math.random(), Math.random(), Math.random(), Math.random() * 0.4, Math.random() * 0.5],
      );
      const at = new Date(Date.now() - d * 864e5 - Math.floor(Math.random() * 20) * 36e5);
      await db.query(
        `insert into plays (user_id, platform, track_id, played_at, ms_played, device, bucket)
         values ($1,'spotify',$2,$3,$4,'phone',$5) on conflict do nothing`,
        [u, id, at, dur, Math.floor(at.getTime() / 10_000)],
      );
      n++;
    }
  }
}

console.log('seeded', n, 'plays');
process.exit(0);
