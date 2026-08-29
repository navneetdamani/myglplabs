import { env } from 'cloudflare:workers';
import { schemaStatements } from '@/db/schema';

export function getDb(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

export async function ensureSchema(db: D1Database) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
}
