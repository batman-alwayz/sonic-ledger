import { createClient } from 'redis';
import { cfg } from './config.js';

export const pub = createClient({ url: cfg.redis });
export const sub = pub.duplicate();

for (const c of [pub, sub]) {
  c.on('error', (e) => console.error('redis', e.message));
}

export const connectRedis = async () => {
  await Promise.all([pub.connect(), sub.connect()]);
};

// token bucket: n calls per windowMs per key
export async function take(key, n = 1, windowMs = 30000) {
  const k = `rl:${key}`;
  const c = await pub.incrBy(k, n);
  if (c === n) await pub.pExpire(k, windowMs);
  return c <= 150;
}

export async function withLock(name, ttlMs, fn) {
  const k = `lock:${name}`;
  const got = await pub.set(k, '1', { NX: true, PX: ttlMs });
  if (!got) return null;
  try {
    return await fn();
  } finally {
    await pub.del(k);
  }
}
