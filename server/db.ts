import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Debug: log connection string with password redacted
const debugUrl = process.env.DATABASE_URL.replace(/:([^@]+)@/, ':****@');
console.log('DATABASE_URL format:', debugUrl);

const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });
