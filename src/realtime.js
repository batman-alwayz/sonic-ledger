import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { createAdapter } from '@socket.io/redis-adapter';
import { cfg } from './config.js';
import { pub, sub } from './redis.js';
import { db } from './db.js';

export function realtime(http) {
  const io = new Server(http, {
    cors: { origin: cfg.webOrigin, credentials: true },
  });
  io.adapter(createAdapter(pub, sub));

  io.use(async (socket, next) => {
    const raw = socket.handshake.headers.cookie?.split(';')
      .map((s) => s.trim()).find((s) => s.startsWith('sl_sid='))?.split('=')[1];
    if (!raw) return next(new Error('unauth'));
    try {
      const { uid } = jwt.verify(decodeURIComponent(raw), cfg.jwt);
      socket.uid = uid;
      next();
    } catch {
      next(new Error('unauth'));
    }
  });

  io.on('connection', async (socket) => {
    socket.join(`u:${socket.uid}`);
    const followers = await db.many(
      `select follower_id from follows where followee_id = $1 and status = 'accepted'`,
      [socket.uid],
    );
    for (const f of followers) socket.join(`u:${f.follower_id}`);
  });

  return io;
}

export async function publishNow(io, userId, payload) {
  io.to(`u:${userId}`).emit('now', payload);
}
