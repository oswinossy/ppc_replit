import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Debug: Parse and check URL format
const url = process.env.DATABASE_URL;
try {
  const parsed = new URL(url);
  console.log('DATABASE_URL parsed:');
  console.log('  - Protocol:', parsed.protocol);
  console.log('  - Username:', parsed.username);
  console.log('  - Host:', parsed.hostname);
  console.log('  - Port:', parsed.port);
  console.log('  - Database:', parsed.pathname);
  console.log('  - Password length:', parsed.password?.length || 0);
  
  if (!parsed.username.includes('.')) {
    console.error('ERROR: Username should be "postgres.PROJECTID", got:', parsed.username);
  }
} catch (e) {
  console.error('Failed to parse DATABASE_URL:', e);
}

const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });
