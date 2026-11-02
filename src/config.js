import 'dotenv/config';

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

export const cfg = {
  port: Number(process.env.PORT || 8080),
  publicUrl: need('PUBLIC_URL'),
  webOrigin: need('WEB_ORIGIN'),
  db: need('DATABASE_URL'),
  redis: need('REDIS_URL'),
  jwt: need('JWT_SECRET'),
  encKey: Buffer.from(need('TOKEN_ENC_KEY'), 'base64'),
  spotify: {
    id: need('SPOTIFY_CLIENT_ID'),
    secret: need('SPOTIFY_CLIENT_SECRET'),
    redirect: need('SPOTIFY_REDIRECT'),
  },
  google: {
    id: need('GOOGLE_CLIENT_ID'),
    secret: need('GOOGLE_CLIENT_SECRET'),
    redirect: need('GOOGLE_REDIRECT'),
  },
  poll: {
    playing: Number(process.env.POLL_PLAYING_MS || 1000),
    paused: Number(process.env.POLL_PAUSED_MS || 2500),
    idle: Number(process.env.POLL_IDLE_MS || 8000),
  },
};

if (cfg.encKey.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes base64');
