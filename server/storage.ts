// Storage interface is not used in this app
// Data is queried directly from Supabase using Drizzle ORM
export interface IStorage {}

export class MemStorage implements IStorage {
  constructor() {}
}

export const storage = new MemStorage();
