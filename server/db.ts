import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Trim any whitespace from URL and fix encoded spaces in password
let connectionUrl = process.env.DATABASE_URL.trim();
// Fix common issue: space encoded as %20 or literal space after colon in password portion
connectionUrl = connectionUrl.replace(/:(%20| )+/g, ':');

const client = postgres(connectionUrl);
export const db = drizzle(client, { schema });
