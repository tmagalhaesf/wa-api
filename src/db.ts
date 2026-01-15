import pg from "pg";

const { Pool } = pg;

function isLocalConnectionString(connectionString: string) {
  return (
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1") ||
    connectionString.includes("::1")
  );
}

function shouldUseSsl(connectionString: string) {
  // Supabase normalmente exige SSL; local normalmente não.
  if (process.env.DATABASE_SSL === "true") return true;
  if (process.env.DATABASE_SSL === "false") return false;
  return !isLocalConnectionString(connectionString);
}

export const pool = (() => {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Postgres is not configured. Set DATABASE_URL (or POSTGRES_URL / SUPABASE_DB_URL)."
    );
  }

  const useSsl = shouldUseSsl(connectionString);
  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
})();

pool.on("error", (err: unknown) => {
  // manter log mínimo; sem segredos
  // eslint-disable-next-line no-console
  console.error("Postgres pool error:", err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  return pool.query<T>(text, params);
}

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const res = await fn(client);
    await client.query("commit");
    return res;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}


