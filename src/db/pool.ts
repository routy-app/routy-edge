import pg from "pg";

export type DbPool = pg.Pool;

export function makePool(databaseUrl: string): DbPool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
}
