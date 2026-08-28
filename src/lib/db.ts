import "server-only";
import { createClient, type Client } from "@libsql/client";
import { config } from "./config";

/**
 * Session storage: libSQL, which is SQLite. Locally `config.db.url` points at a
 * file; in production it points at a Turso database. Same engine, same SQL —
 * only the connection string changes.
 *
 * The knowledge base deliberately does NOT live here: dilemmas and the GUI
 * template are versioned files in the git repository (see lib/store/kb.ts).
 * This database holds the operational log — who trained on what, and how it
 * went — which changes too often to belong in commit history.
 */

let client: Client | undefined;
let ready: Promise<void> | undefined;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS trainees (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     notes       TEXT NOT NULL DEFAULT '',
     created_at  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS instructors (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     created_at  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id                   TEXT PRIMARY KEY,
     trainee_id           TEXT NOT NULL,
     dilemma_entry_id     TEXT NOT NULL,
     requested_text       TEXT NOT NULL,
     clarification_rounds TEXT NOT NULL DEFAULT '[]',
     difficulty_level     TEXT NOT NULL,
     scenario_instance    TEXT NOT NULL,
     decisions_made       TEXT NOT NULL DEFAULT '[]',
     outcome              TEXT,
     score                REAL,
     debrief_text         TEXT NOT NULL DEFAULT '',
     recommendations      TEXT NOT NULL DEFAULT '[]',
     status               TEXT NOT NULL DEFAULT 'in_progress',
     created_at           TEXT NOT NULL,
     completed_at         TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_by_trainee
     ON sessions (trainee_id, created_at DESC)`,
];

/**
 * A POC has no sign-up flow, so an empty database is a dead end — the trainee
 * screen would have nobody to attribute a session to. Seed a small roster the
 * first time the schema is created.
 */
const SEED_TRAINEES = [
  "Trainee A — Ops Console 1",
  "Trainee B — Ops Console 2",
  "Trainee C — Ops Console 3",
];

async function initialise(db: Client): Promise<void> {
  for (const statement of SCHEMA) {
    await db.execute(statement);
  }

  const existing = await db.execute("SELECT COUNT(*) AS n FROM trainees");
  if (Number(existing.rows[0]?.n ?? 0) > 0) return;

  const now = new Date().toISOString();
  for (const name of SEED_TRAINEES) {
    await db.execute({
      sql: "INSERT INTO trainees (id, name, notes, created_at) VALUES (?, ?, '', ?)",
      args: [crypto.randomUUID(), name, now],
    });
  }
  await db.execute({
    sql: "INSERT INTO instructors (id, name, created_at) VALUES (?, ?, ?)",
    args: [crypto.randomUUID(), "Duty Instructor", now],
  });
}

/**
 * Returns a ready-to-use client, creating the schema exactly once per process.
 * Every caller awaits the same initialisation promise, so concurrent requests
 * during a cold start cannot race each other into a half-built schema.
 */
export async function db(): Promise<Client> {
  if (!client) {
    client = createClient({
      url: config.db.url,
      authToken: config.db.authToken,
    });
  }
  if (!ready) {
    ready = initialise(client).catch((reason) => {
      // Let the next request retry rather than caching a failed init forever.
      ready = undefined;
      throw reason;
    });
  }
  await ready;
  return client;
}

/** Parses a JSON column, falling back to `fallback` if the column is empty. */
export function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
