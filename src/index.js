import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cfg } from './config.js';

// FIX (website): the frontend now lives in /public and is served by this same
// Express app, at the same origin as the API. That is what makes the
// sl_sid cookie (SameSite=Lax) actually arrive on every /me, /friends, etc.
// request — a frontend on a different port/origin would have its fetch()
// calls sent without the cookie, since Lax cookies are not attached to
// cross-site subresource requests, only to top-level navigations.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { connectRedis, sub } from './redis.js';
import { attach } from './session.js';
import { auth } from './auth/routes.js';
import { me } from './routes/me.js';
import { friends } from './routes/friends.js';
import { feed } from './routes/feed.js';
import { playlists } from './routes/playlists.js';
import { contests } from './routes/contests.js';
import { importer } from './routes/import.js';
import { realtime } from './realtime.js';
import { db } from './db.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: cfg.webOrigin, credentials: true }));
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use(attach);

app.get('/health', async (_req, res) => {
  try { await db.query('select 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use('/auth', auth);
app.use('/me', me);
app.use('/friends', friends);
app.use('/feed', feed);
app.use('/playlists', playlists);
app.use('/contests', contests);
app.use('/import', importer);

app.use(express.static(path.join(__dirname, '..', 'public')));
// any non-API GET falls through to the single-page app
app.get(/^(?!\/(auth|me|friends|feed|playlists|contests|import|health)(\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'server_error' });
});

const http = createServer(app);
const io = realtime(http);

await connectRedis();

await sub.subscribe('now', async (msg) => {
  const p = JSON.parse(msg);
  io.to(`u:${p.userId}`).emit('now', p);
});
await sub.subscribe('scrobble', async (msg) => {
  const p = JSON.parse(msg);
  io.to(`u:${p.userId}`).emit('scrobble', p);
});
await sub.subscribe('contest', async (msg) => {
  io.emit('contest:update', JSON.parse(msg));
});

http.listen(cfg.port, () => console.log('api on', cfg.port));
