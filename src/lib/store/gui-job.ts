import "server-only";
import { z } from "zod";
import { systemPaths } from "../config";
import { type Job, asReported, isStale, jobRecord } from "./job";

/**
 * The record of one console generation.
 *
 * Building a console is the longest single step in the app, so the browser does
 * not wait for it. See `job.ts` for why, and for the machinery this uses.
 */

const GuiJobResultSchema = z.object({
  html: z.string(),
  design_notes: z.string(),
  screenshots: z.array(z.string()),
  missing_slots: z.array(z.string()),
  /**
   * Every change asked for, oldest first, that this build answers.
   *
   * Kept because the build outlives the page that started it. A designer who
   * asks for a change and then goes to look at the result is on a different
   * screen by the time it lands, and accepting it there has to write the same
   * thread back — otherwise approving the console would quietly drop the
   * requests that shaped it, and the next revision would undo them.
   *
   * Defaulted, so builds recorded before this existed still load.
   */
  requests: z.array(z.string()).default([]),
});

export type GuiJobResult = z.infer<typeof GuiJobResultSchema>;
export type GuiJob = Job<GuiJobResult>;

const record = jobRecord(GuiJobResultSchema);
const pathFor = (systemId: string) => systemPaths(systemId).guiJob;

export function readGuiJob(systemId: string): Promise<GuiJob | null> {
  return record.read(pathFor(systemId));
}

export function startGuiJob(
  systemId: string,
  systemName: string,
): Promise<GuiJob> {
  return record.start(
    pathFor(systemId),
    `Start console generation: ${systemName}`,
  );
}

export function finishGuiJob(
  systemId: string,
  systemName: string,
  result: GuiJobResult,
): Promise<void> {
  return record.finish(
    pathFor(systemId),
    `Console generated: ${systemName}`,
    result,
  );
}

export function failGuiJob(
  systemId: string,
  systemName: string,
  error: string,
): Promise<void> {
  return record.fail(
    pathFor(systemId),
    `Console generation failed: ${systemName}`,
    error,
  );
}

export { asReported, isStale };
