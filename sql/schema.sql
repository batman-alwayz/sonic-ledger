create extension if not exists "pgcrypto";

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  handle        text unique not null,
  display_name  text not null,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

create table platform_links (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  platform      text not null check (platform in ('spotify','ytmusic')),
  access_token  text,
  refresh_token text,
  scopes        text,
  expires_at    timestamptz,
  cursor        text,
  state         text not null default 'idle',
  last_poll_at  timestamptz,
  failures      int not null default 0,
  unique (user_id, platform)
);
create index platform_links_active on platform_links (state) where state <> 'off';

create table tracks (
  id           text primary key,
  platform     text not null,
  title        text not null,
  artist       text not null,
  album        text,
  duration_ms  int not null,
  bpm          int,
  decade       int,
  tags         text[] default '{}'
);
create index tracks_artist on tracks (lower(artist));

create table track_features (
  track_id         text primary key references tracks(id) on delete cascade,
  energy           real,
  danceability     real,
  valence          real,
  acousticness     real,
  instrumentalness real,
  source           text not null default 'spotify'
);

create table plays (
  id         bigserial primary key,
  user_id    uuid not null references users(id) on delete cascade,
  platform   text not null,
  track_id   text not null references tracks(id),
  played_at  timestamptz not null,
  ms_played  int not null default 0,
  device     text,
  bucket     bigint not null
);
create unique index plays_dedupe on plays (user_id, track_id, bucket);
create index plays_user_time on plays (user_id, played_at desc);
create index plays_time on plays (played_at desc);

create table follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  status      text not null default 'accepted' check (status in ('pending','accepted')),
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on follows (followee_id);

create table contests (
  id         bigserial primary key,
  week_start date not null unique,
  metric     text not null default 'minutes',
  winner_id  uuid references users(id) on delete set null,
  closed_at  timestamptz
);

create table playlist_exports (
  id           bigserial primary key,
  user_id      uuid not null references users(id) on delete cascade,
  source       text not null,
  spotify_id   text,
  name         text not null,
  track_count  int not null default 0,
  skipped      int not null default 0,
  url          text,
  created_at   timestamptz not null default now()
);

create table sessions_log (
  id         bigserial primary key,
  user_id    uuid references users(id) on delete set null,
  ip         inet,
  ua         text,
  created_at timestamptz not null default now()
);
