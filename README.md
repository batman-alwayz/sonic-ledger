# sonic ledger

Unified listening tracker for Spotify (YouTube Music via Takeout import). Real OAuth,
real Spotify API calls, a worker that polls every 1s while a track is playing, and
instant live updates pushed to the browser over Redis pub/sub + sockets.

## It's now a website, not just an API

`public/` is a plain HTML/CSS/JS frontend (no build step) served by the same Express app
at `src/index.js`, at the same origin as the API. That's deliberate, not just convenience:
your `sl_sid` cookie is `SameSite=Lax`, and Lax cookies are **not** sent on cross-site
`fetch()`/XHR calls — only on top-level navigations. A separate frontend on its own port
(what `WEB_ORIGIN=http://localhost:5173` implied originally) would silently lose the
session on every API call made from JavaScript. Serving both from one origin avoids that
class of bug entirely, so `.env.example` now sets `WEB_ORIGIN` equal to `PUBLIC_URL`.

What the site covers: login (Spotify or Google), an overview tab (minutes, plays, radar,
listening clock, platform split, scrobble velocity, top artists/tracks), a friends tab
(your handle, adding friends, the weekly contest board, live-now via sockets, and
compare), and a connect tab (Spotify connect status, the YouTube Music Takeout import,
and playlist export). It's untested — I can't run a browser against this server here — so
treat the first real run as the actual test, especially the socket reconnect-on-add-friend
logic in `app.js`.

**One real limitation worth knowing:** `follows` is one-directional. If you add a friend
by handle, you see their live-now and they show up in your contest board, but they won't
see you until they add you back. The UI says this; it isn't a bug, just how the schema
you wrote models it. If you'd rather it auto-reciprocate, that's a schema change
(`follows.status` already has a `pending`/`accepted` idea half-built in — it's not used by
any route yet, so symmetric friending would mean wiring that up).

## What changed from the version you pasted

**Fix #1 — `track_features` / audio-features call was silently broken.**
`worker/poller.js`'s `upsertTrack()` called `sp.audioFeatures({ user_id: 'worker' }, ids)` —
a fake link with no token for `accessToken()` to use. Every call threw, was swallowed by
an empty `catch {}`, and the radar chart's data source never populated, with no error
anywhere. It now takes the real `link` already in scope in `step()` and passes it through
at both call sites. It will still legitimately return `[]` for any Spotify app created
after 2024-11-27, since Spotify restricted that endpoint — that's an expected, non-error
outcome now, not a silent failure.

**Fix #2 — new accounts waited up to 30s before their polling loop started.**
`auth/routes.js` (written fresh — it wasn't in what you pasted, only referenced) now
publishes a `link:new` Redis message the instant a Spotify link is saved. `poller.js`
subscribes to it and starts that link's loop immediately. The original 30s `setInterval`
sweep is kept as a safety net in case the worker was briefly down when the message fired.
A `running` Set was added so a link can never get two loops going at once.

**Fix #3 — worker wasn't started by `npm run dev`.**
Added `npm run dev:all` (via `concurrently`) to run the API and the worker together for
local development. `docker-compose.yml` already ran them as separate services correctly —
that part of your original file is untouched.

**`worker/ytmusic.js` is kept but quarantined, not deleted.** It's never imported by
`index.js`, `poller.js`, or `routes/import.js`. The only YouTube Music path actually wired
into the app is the Takeout-file importer. See the warning comment at the top of that file
for why: it uses a scraped session cookie against Google's private API, which is a ToS
violation and risks the *user's* account, not just this one.

## Setup

    cp .env.example .env            # fill in the values below
    docker compose up -d postgres redis
    npm install
    npm run migrate
    npm run dev:all                 # runs api + worker together

Open http://localhost:8080 — that's the website now, served directly by the API process.
Set the Spotify app's redirect URI to
`$PUBLIC_URL/auth/spotify/callback`, and Google's (if used) to `$PUBLIC_URL/auth/google/callback`.

### Generating secrets for `.env`

    # JWT_SECRET — any long random string
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

    # TOKEN_ENC_KEY — must be exactly 32 bytes, base64-encoded
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

## Scopes requested

    user-read-recently-played
    user-read-currently-playing
    user-read-playback-state
    user-read-private
    playlist-modify-private
    playlist-modify-public

The playlist scopes grant write access to a friend's library (for the playlist-export
feature), not just read access — worth saying so explicitly if you invite friends in.

## Deploying

**Not Cloudflare Workers.** This app needs a persistent Node process, raw TCP connections
to Postgres and Redis, a `setInterval`-driven poll loop, and a `socket.io` WebSocket
server. None of those run on Workers without a substantial rewrite (Hyperdrive for
Postgres, Durable Object alarms instead of the poll loop, a different realtime transport
instead of socket.io). Use a host that runs `docker-compose.yml` as-is instead:

**Railway** (closest to a one-command deploy of this exact file):

    railway up

Then in the Railway dashboard: add the Postgres and Redis plugins (or point
`DATABASE_URL`/`REDIS_URL` at managed ones), set every variable from `.env.example`,
set `PUBLIC_URL`/`WEB_ORIGIN` to your Railway domain, and make sure both the `api` and
`worker` services from `docker-compose.yml` are deployed — Railway can run a
compose file's services as separate deployments.

**Fly.io** (if you'd rather use `flyctl`):

    fly launch --now

`fly launch` reads `Dockerfile`, offers to provision Postgres and Redis, and will ask you
to confirm a `fly.toml`. You'll still need a second `fly.toml` process (or a `[processes]`
block with `api` and `worker`) so the poller actually runs — a single `fly launch` only
starts the Dockerfile's default `CMD`, which is the API alone.

Either way: run the Postgres and Redis add-ons, set the same `.env.example` variables in
the host's dashboard, update the Spotify (and Google, if used) redirect URIs to your live
`PUBLIC_URL`, and deploy both the `api` and `worker` processes — not just one.
