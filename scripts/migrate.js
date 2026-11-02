import { readFile } from 'node:fs/promises';
import { db } from '../src/db.js';

const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
await db.query(sql);
console.log('migrated');
process.exit(0);
