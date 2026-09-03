import "server-only";
import { z } from "zod";
import { repoFiles } from "./repo-files";

/**
 * A piece of work the browser does not wait for.
 *
 * Three things this app does take longer than a minute: extracting a scenario
 * from an interview, generating an exercise, and building a console. A phone
 * will not hold a connection that long — the screen locks, the tab is
 * suspended, and the request dies with a bare "Load failed" while the server is
 * still working perfectly. Raising the server's own ceiling does not help,
 * because it was never the server that gave up.
 *
 * So the request that starts the work returns at once with a job record, the
 * work continues on the server, and the browser asks every few seconds whether
 * it has finished. Closing the page and coming back then costs nothing.
 *
 * This lives beside the store rather than in `domain/schemas.ts` on purpose.
 * That file holds the records a domain expert authors and the model produces;
 * this is plumbing that happens to be persisted, and putting it there would
 * blur what that file is for.
 */

export interface Job<TResult> {
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  error: string | null;
  result: TResult | null;
}

/** A job as the browser sees it. "idle" means nothing was ever started. */
export type ReportedJob<TResult> = Job<TResult> | { status: "idle" };

/**
 * How long a job may claim to be running before we stop believing it.
 *
 * The platform kills the function at five minutes, so anything still "running"
 * past that was cut off mid-flight and will never write its own ending.
 * Without this the screen would poll for ever on work that is already dead.
 */
const STALE_AFTER_MS = 6 * 60 * 1000;

/** True when a job claims to be running but the function that owned it is gone. */
export function isStale(job: Job<unknown>): boolean {
  return (
    job.status === "running" &&
    Date.now() - Date.parse(job.started_at) > STALE_AFTER_MS
  );
}

/**
 * A job that died mid-flight is reported as failed rather than as running, so
 * the screen stops waiting for an answer that is never coming.
 */
export function asReported<TResult>(
  job: Job<TResult> | null,
): ReportedJob<TResult> {
  if (!job) return { status: "idle" };
  if (isStale(job)) {
    return {
      ...job,
      status: "failed",
      error:
        "It was cut off before it finished. Start it again — nothing was saved.",
    };
  }
  return job;
}

/**
 * The four operations every job needs, over one result shape.
 *
 * The caller supplies the path, because what a job belongs to differs: a
 * console belongs to a system, an exercise to the trainee waiting for it. Each
 * key holds one job and is overwritten by the next, so these records never
 * accumulate.
 */
export function jobRecord<TResult>(resultSchema: z.ZodType<TResult>) {
  const schema = z.object({
    status: z.enum(["running", "done", "failed"]),
    started_at: z.string(),
    finished_at: z.string().nullable(),
    error: z.string().nullable(),
    result: resultSchema.nullable(),
  });

  async function read(path: string): Promise<Job<TResult> | null> {
    const raw = await repoFiles().read(path);
    if (raw === null) return null;

    let parsed;
    try {
      parsed = schema.safeParse(JSON.parse(raw));
    } catch {
      parsed = { success: false } as const;
    }
    if (!parsed.success) {
      // A malformed job is worth ignoring rather than crashing the screen: the
      // person looking at it can simply start another one.
      console.error(`Ignoring malformed job record at ${path}`);
      return null;
    }
    return parsed.data as Job<TResult>;
  }

  async function write(
    path: string,
    job: Job<TResult>,
    message: string,
  ): Promise<void> {
    await repoFiles().write(
      path,
      `${JSON.stringify(schema.parse(job), null, 2)}\n`,
      message,
    );
  }

  return {
    read,

    async start(path: string, message: string): Promise<Job<TResult>> {
      const job: Job<TResult> = {
        status: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        error: null,
        result: null,
      };
      await write(path, job, message);
      return job;
    },

    async finish(
      path: string,
      message: string,
      result: TResult,
    ): Promise<void> {
      // Keeping the original start time makes "how long did that take" a
      // question the record can answer after the fact.
      const existing = await read(path);
      await write(
        path,
        {
          status: "done",
          started_at: existing?.started_at ?? new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error: null,
          result,
        },
        message,
      );
    },

    async fail(path: string, message: string, error: string): Promise<void> {
      const existing = await read(path);
      await write(
        path,
        {
          status: "failed",
          started_at: existing?.started_at ?? new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error,
          result: null,
        },
        message,
      );
    },
  };
}
