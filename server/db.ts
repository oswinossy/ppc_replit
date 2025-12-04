import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Robustly clean the DATABASE_URL of any whitespace, newlines, or special characters
let connectionUrl = process.env.DATABASE_URL
  .replace(/[\r\n\t]/g, '')  // Remove all newlines, carriage returns, tabs
  .trim()                     // Remove leading/trailing whitespace
  .replace(/\s+/g, '');       // Remove any remaining internal whitespace

// Fix common issue: space encoded as %20 after colon in password portion
connectionUrl = connectionUrl.replace(/:(%20)+/g, ':');

const client = postgres(connectionUrl);
export const db = drizzle(client, { schema });
