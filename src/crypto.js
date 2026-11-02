import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { cfg } from './config.js';

const ALGO = 'aes-256-gcm';

export function seal(plain) {
  if (plain == null) return null;
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, cfg.encKey, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function open(sealed) {
  if (!sealed) return null;
  const buf = Buffer.from(sealed, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = createDecipheriv(ALGO, cfg.encKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export const randomState = () => randomBytes(24).toString('base64url');
