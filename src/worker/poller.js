import { db } from '../db.js';
import { cfg } from '../config.js';
import * as sp from '../spotify.js';
import { pub, sub, take, withLock, connectRedis } from '../redis.js';

const state = new Map(); // linkId -> { cur, startedAt, logged, delay }
const running = new Set(); // linkIds with an active loop, so we never start two loops for one link

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function commit(link, trackId, startedAt, msPlayed) {
  const bucket = Math.floor(startedAt.getTime() / 10_000);
  const r = await db.query(
    `insert into plays (user_id, platform, track_id, played_at, ms_played, device, bucket)
     values ($1,'spotify',$2,$3,$4,'live',$5) on conflict do nothing`,
    [link.user_id, trackId, startedAt, msPlayed, bucket],
  );
  if (r.rowCount) {
    await pub.publish('scrobble', JSON.stringify({ userId: link.user_id, trackId, at: startedAt }));
  }
}

// FIX (#1): this used to be called with a fake link ({ user_id: 'worker' }), which has no
// access_token/expires_at/refresh_token for accessToken() to use, so every call threw and
// was swallowed by the empty catch — audio features silently never populated. It now takes
// the real link that the poll loop already holds, so the request can actually authenticate.
// Still expected to return [] for Spotify apps created after 2024-11-27 (endpoint restricted),
// which is a normal, non-error outcome handled by the caller.
async function upsertTrack(item, link) {
  await db.query(
    `insert into tracks (id, platform, title, artist, album, duration_ms)
     values ($1,'spotify',$2,$3,$4,$5) on conflict (id) do nothing`,
    [item.id, item.name, item.artists?.[0]?.name ?? 'unknown', item.album?.name ?? null, item.duration_ms],
  );
  try {
    const f = await sp.audioFeatures(link, [item.id]);
    const row = f[0];
    if (row) {
      await db.query(
        `insert into track_features (track_id, energy, danceability, valence, acousticness, instrumentalness)
         values ($1,$2,$3,$4,$5,$6) on conflict (track_id) do nothing`,
        [item.id, row.energy, row.danceability, row.valence, row.acousticness, row.instrumentalness],
      );
    }
  } catch {}
}

async function step(link) {
  const st = state.get(link.id) ?? { cur: null, startedAt: 0, logged: false, delay: cfg.poll.idle };

  if (!(await take(`sp:${link.user_id}`))) {
    st.delay = 2000;
    state.set(link.id, st);
    return;
  }

  let res;
  try {
    res = await sp.player(link);
  } catch (e) {
    if (e.status === 429) { st.delay = 3000; state.set(link.id, st); return; }
    st.delay = 5000;
    await db.query('update platform_links set failures = failures + 1 where id = $1', [link.id]);
    return;
  }

  if (res.status === 204) {
    if (st.cur) { await commit(link, st.cur.id, new Date(st.startedAt), Date.now() - st.startedAt); st.cur = null; }
    st.delay = cfg.poll.idle;
    state.set(link.id, st);
    await pub.publish('now', JSON.stringify({ userId: link.user_id, state: 'idle' }));
    return;
  }
  if (!res.ok) { st.delay = 4000; state.set(link.id, st); return; }

  const s = await res.json();
  if (!s.item) { st.delay = cfg.poll.idle; state.set(link.id, st); return; }

  if (st.cur?.id !== s.item.id) {
    if (st.cur) {
      const played = Date.now() - st.startedAt;
      const need = Math.min(30_000, st.cur.duration_ms * 0.5);
      if (played >= need) await commit(link, st.cur.id, new Date(st.startedAt), played);
    }
    await upsertTrack(s.item, link); // FIX (#1): pass the real link through
    st.cur = { id: s.item.id, duration_ms: s.item.duration_ms };
    st.startedAt = Date.now() - (s.progress_ms ?? 0);
    st.logged = false;
  }

  st.delay = s.is_playing ? cfg.poll.playing : cfg.poll.paused;
  state.set(link.id, st);

  await pub.publish('now', JSON.stringify({
    userId: link.user_id,
    state: s.is_playing ? 'playing' : 'paused',
    track: { id: s.item.id, title: s.item.name, artist: s.item.artists?.[0]?.name },
    progress: s.progress_ms,
    duration: s.item.duration_ms,
  }));
}

async function loop(link) {
  if (running.has(link.id)) return; // never double-start a link's loop
  running.add(link.id);
  const st = state.get(link.id) ?? { cur: null, startedAt: 0, logged: false, delay: cfg.poll.idle };
  state.set(link.id, st);
  while (true) {
    try {
      await withLock(`poll:${link.id}`, 10_000, () => step(link));
    } catch (e) {
      console.error('poll', link.id, e.message);
    }
    await sleep(state.get(link.id)?.delay || cfg.poll.idle);
  }
}

async function boot() {
  await connectRedis();
  const links = await db.many(`select * from platform_links where state = 'active'`);
  console.log(`polling ${links.length} link(s)`);
  for (const l of links) loop(l);

  // FIX (#2): previously a newly-connected account waited up to 30s for the setInterval
  // sweep below to notice it. auth/routes.js now publishes to this channel the moment a
  // Spotify link is saved, so its loop starts within ~1 request round trip, not 30s.
  await sub.subscribe('link:new', async (msg) => {
    try {
      const { linkId } = JSON.parse(msg);
      if (running.has(linkId)) return;
      const link = await db.one(`select * from platform_links where id = $1 and state = 'active'`, [linkId]);
      if (link) { console.log('link:new', linkId, '— starting loop immediately'); loop(link); }
    } catch (e) { console.error('link:new handler', e.message); }
  });

  // safety net: picks up any link the pub/sub message missed (e.g. worker was briefly down)
  setInterval(async () => {
    const fresh = await db.many(`select * from platform_links where state = 'active'`);
    for (const l of fresh) if (!running.has(l.id)) loop(l);
  }, 30_000);

  // backfill after downtime
  setInterval(async () => {
    const stale = await db.many(
      `select * from platform_links where state = 'active' and last_poll_at < now() - interval '10 minutes'`,
    );
    for (const l of stale) {
      try {
        const r = await sp.recentlyPlayed(l, 50);
        if (!r.ok) continue;
        const j = await r.json();
        for (const it of j.items ?? []) {
          const playedAt = new Date(it.played_at);
          const bucket = Math.floor(playedAt.getTime() / 10_000);
          await upsertTrack(it.track, l); // FIX (#1) applies here too
          await db.query(
            `insert into plays (user_id, platform, track_id, played_at, ms_played, bucket)
             values ($1,'spotify',$2,$3,$4,$5) on conflict do nothing`,
            [l.user_id, it.track.id, playedAt, it.track.duration_ms, bucket],
          );
        }
      } catch {}
      await db.query('update platform_links set last_poll_at = now() where id = $1', [l.id]);
    }
  }, 120_000);
}

boot();
