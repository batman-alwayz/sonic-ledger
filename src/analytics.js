import { db } from './db.js';

const WINDOWS = { '7d': 7, '4w': 28, '6m': 182, '1y': 365, all: 3650 };

export const windowDays = (w) => WINDOWS[w] ?? 28;

export async function summary(userId, w) {
  const days = windowDays(w);
  const rows = await db.many(
    `select
       coalesce(sum(p.ms_played)/60000.0, 0)                        as minutes,
       count(*)                                                     as plays,
       count(distinct p.track_id)                                   as songs,
       count(distinct t.artist)                                     as artists,
       count(distinct t.album)                                      as albums,
       coalesce(avg(t.duration_ms)/60000.0, 0)                      as avg_track_min
     from plays p join tracks t on t.id = p.track_id
     where p.user_id = $1 and p.played_at >= now() - ($2 || ' days')::interval`,
    [userId, days],
  );
  const r = rows[0];
  return {
    minutes: Number(r.minutes),
    plays: Number(r.plays),
    songs: Number(r.songs),
    artists: Number(r.artists),
    albums: Number(r.albums),
    avgPerDay: Number(r.minutes) / days,
    avgTrackMin: Number(r.avg_track_min),
  };
}

export const topArtists = (userId, w, limit = 50) =>
  db.many(
    `select t.artist as name, sum(p.ms_played)/60000.0 as minutes, count(*) as plays
       from plays p join tracks t on t.id = p.track_id
      where p.user_id = $1 and p.played_at >= now() - ($2 || ' days')::interval
      group by t.artist order by minutes desc limit $3`,
    [userId, windowDays(w), limit],
  );

export const topTracks = (userId, w, limit = 50) =>
  db.many(
    `select t.id, t.title, t.artist, t.album, sum(p.ms_played)/60000.0 as minutes, count(*) as plays
       from plays p join tracks t on t.id = p.track_id
      where p.user_id = $1 and p.played_at >= now() - ($2 || ' days')::interval
      group by t.id order by minutes desc limit $3`,
    [userId, windowDays(w), limit],
  );

export const topAlbums = (userId, w, limit = 50) =>
  db.many(
    `select t.album as name, t.artist, sum(p.ms_played)/60000.0 as minutes
       from plays p join tracks t on t.id = p.track_id
      where p.user_id = $1 and p.played_at >= now() - ($2 || ' days')::interval
        and t.album is not null
      group by t.album, t.artist order by minutes desc limit $3`,
    [userId, windowDays(w), limit],
  );

export const clock = (userId, w) =>
  db.many(
    `select extract(hour from p.played_at)::int as hour, sum(p.ms_played)/60000.0 as minutes
       from plays p
      where p.user_id = $1 and p.played_at >= now() - ($2 || ' days')::interval
      group by 1 order by 1`,
    [userId, windowDays(w)],
  );

export const decades = (userId, w) =>
  db.many(
    `select t.decade, sum(p.ms_played)/60000.0 as minutes, count(*) as plays
       from plays p join tracks t on t.id = p.track_id
      where p.user_id = $1 and p.played_at >= now() - ($2 || ' days')::interval
        and t.decade is not null
      group by t.decade order by t.decade`,
    [userId, windowDays(w)],
  );

export async function radar(userId, w) {
  const r = await db.one(
    `select
       sum(f.energy           * p.ms_played) / sum(p.ms_played) as energy,
       sum(f.danceability     * p.ms_played) / sum(p.ms_played) as danceability,
       sum(f.valence          * p.ms_played) / sum(p.ms_played) as valence,
       sum(f.acousticness     * p.ms_played) / sum(p.ms_played) as acousticness,
       sum(f.instrumentalness * p.ms_played) / sum(p.ms_played) as instrumentalness
     from plays p join track_features f on f.track_id = p.track_id
     where p.user_id = $1 and p.played_at >= now() - ($2 || ' days')::interval`,
    [userId, windowDays(w)],
  );
  const n = (v) => (v == null ? 0 : Math.round(Number(v) * 1000) / 1000);
  return {
    energy: n(r?.energy), danceability: n(r?.danceability), valence: n(r?.valence),
    acousticness: n(r?.acousticness), instrumentalness: n(r?.instrumentalness),
  };
}

export async function velocity(userId) {
  const r = await db.one(
    `select
       count(*) filter (where played_at >= now() - interval '14 days') / 14.0 as recent,
       count(*) filter (where played_at <  now() - interval '14 days'
                          and played_at >= now() - interval '59 days') / 45.0 as base
     from plays where user_id = $1 and played_at >= now() - interval '59 days'`,
    [userId],
  );
  const recent = Number(r?.recent || 0);
  const base = Number(r?.base || 0) || 0.01;
  return { recent, base, ratio: Math.round((recent / base) * 100) / 100 };
}

export async function platformSplit(userId, w) {
  const rows = await db.many(
    `select platform, sum(ms_played)/60000.0 as minutes
       from plays where user_id = $1 and played_at >= now() - ($2 || ' days')::interval
      group by platform order by minutes desc`,
    [userId, windowDays(w)],
  );
  const total = rows.reduce((a, b) => a + Number(b.minutes), 0) || 1;
  return rows.map((r) => ({ platform: r.platform, share: Math.round((Number(r.minutes) / total) * 100) }));
}

export async function obsession(userId) {
  const rows = await db.many(
    `with wk as (
       select t.artist, sum(p.ms_played)/60000.0 m
         from plays p join tracks t on t.id = p.track_id
        where p.user_id = $1 and p.played_at >= now() - interval '7 days'
        group by t.artist
     ), mo as (
       select t.artist, sum(p.ms_played)/60000.0 m
         from plays p join tracks t on t.id = p.track_id
        where p.user_id = $1 and p.played_at >= now() - interval '28 days'
        group by t.artist
     )
     select wk.artist, wk.m, wk.m / greatest(mo.m / 4, 1) as ratio
       from wk join mo using (artist)
      where wk.m > 25 and wk.m / greatest(mo.m / 4, 1) > 1.8
      order by ratio desc limit 5`,
    [userId],
  );
  return rows.map((r) => ({ artist: r.artist, minutes: Number(r.m), ratio: Number(r.ratio) }));
}

export async function sharedArtists(a, b) {
  return db.many(
    `with ta as (
       select t.artist, sum(p.ms_played) m from plays p join tracks t on t.id = p.track_id
        where p.user_id = $1 and p.played_at >= now() - interval '28 days'
        group by t.artist order by m desc limit 15
     ), tb as (
       select t.artist, sum(p.ms_played) m from plays p join tracks t on t.id = p.track_id
        where p.user_id = $2 and p.played_at >= now() - interval '28 days'
        group by t.artist order by m desc limit 15
     )
     select ta.artist from ta join tb using (artist)`,
    [a, b],
  );
}

export function cosine(a, b) {
  const keys = Object.keys(a);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
