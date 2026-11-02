import pg from 'pg';
import { cfg } from './config.js';

export const pool = new pg.Pool({ connectionString: cfg.db, max: 12 });

export const db = {
  query: (text, params) => pool.query(text, params),
  one: async (text, params) => (await pool.query(text, params)).rows[0] ?? null,
  many: async (text, params) => (await pool.query(text, params)).rows,
  tx: async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  },
};
