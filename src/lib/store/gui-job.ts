import "server-only";
import { z } from "zod";
import { systemPaths } from "../config";
import { repoFiles } from "./repo-files";

/**
 * The record of one console generation, so the browser does not have to hold
 * the connection open while it happens.
 *
 * Building a console takes a minute or more. A phone will not wait that long:
 * the screen locks, the tab is suspended, and the request dies with a bare
 * "Load failed" — the work was fine, the wire was not. So the request that
 * starts the work returns immediately, the work continues on the server, and
 * the browser asks every few seconds whether it is finished. Closing the page
 * and coming back now costs nothing.
 *
 * This lives beside the store rather than in `domain/schemas.ts` on purpose.
 * That file holds the records a domain expert authors and the model produces;
 * this is a piece of plumbing that happens to be persisted, and putting it
 * there would blur what that file is for.
 */

const GuiJobResultSchema = z.object({
  html: z.string(),
  design_notes: z.string(),
  screenshots: z.array(z.string()),
  missing_slots: z.array(z.string()),
});

const GuiJobSchema = z.object({
  status: z.enum(["running", "done", "failed"]),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
  result: GuiJobResultSchema.nullable(),
});

export type GuiJob = z.infer<typeof GuiJobSchema>;
export type GuiJobResult = z.infer<typeof GuiJobResultSchema>;

/**
 * How long a job may claim to be running before we stop believing it.
 *
 * The function is killed at five minutes, so anything still "running" past
 * that was cut off mid-flight and will never write its own ending. Without
 * this the screen would poll for ever on a job that is already dead.
 */
const STALE_AFTER_MS = 6 * 60 * 1000;

export async function readGuiJob(systemId: string): Promise<GuiJob | null> {
  const raw = await repoFiles().read(systemPaths(systemId).guiJob);
  if (raw === null) return null;

  const parsed = GuiJobSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // A malformed job is worth ignoring rather than crashing the screen: the
    // designer can simply start another one.
    console.error(`Ignoring malformed console job for ${systemId}`);
    return null;
  }
  return parsed.data;
}

async function writeGuiJob(
  systemId: string,
  job: GuiJob,
  message: string,
): Promise<void> {
  await repoFiles().write(
    systemPaths(systemId).guiJob,
    `${JSON.stringify(GuiJobSchema.parse(job), null, 2)}\n`,
    message,
  );
}

export async function startGuiJob(
  systemId: string,
  systemName: string,
): Promise<GuiJob> {
  const job: GuiJob = {
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
    result: null,
  };
  await writeGuiJob(systemId, job, `Start console generation: ${systemName}`);
  return job;
}

export async function finishGuiJob(
  systemId: string,
  systemName: string,
  result: GuiJobResult,
): Promise<void> {
  const existing = await readGuiJob(systemId);
  await writeGuiJob(
    systemId,
    {
      status: "done",
      started_at: existing?.started_at ?? new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error: null,
      result,
    },
    `Console generated: ${systemName}`,
  );
}

export async function failGuiJob(
  systemId: string,
  systemName: string,
  error: string,
): Promise<void> {
  const existing = await readGuiJob(systemId);
  await writeGuiJob(
    systemId,
    {
      status: "failed",
      started_at: existing?.started_at ?? new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error,
      result: null,
    },
    `Console generation failed: ${systemName}`,
  );
}

/** True when a job claims to be running but the function that owned it is gone. */
export function isStale(job: GuiJob): boolean {
  return (
    job.status === "running" &&
    Date.now() - Date.parse(job.started_at) > STALE_AFTER_MS
  );
}

/**
 * The job as the browser should see it.
 *
 * A job that died mid-flight is reported as failed rather than as running, so
 * the screen stops waiting for an answer that is never coming.
 */
export function asReported(job: GuiJob | null): GuiJob | { status: "idle" } {
  if (!job) return { status: "idle" };
  if (isStale(job)) {
    return {
      ...job,
      status: "failed",
      error:
        "The generation was cut off before it finished. Start it again — nothing was saved.",
    };
  }
  return job;
}
