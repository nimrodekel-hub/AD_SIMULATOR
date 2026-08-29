import "server-only";
import { z } from "zod";
import { systemPaths } from "../config";
import { repoFiles } from "./repo-files";
import { DilemmaDraftSchema } from "../domain/schemas";
import { type Job, asReported, isStale, jobRecord } from "./job";

/**
 * The record of one dilemma being extracted from an interview.
 *
 * Reading a whole interview and turning it into a structured record takes
 * well over a minute — measured against production, longer than the console
 * build. See `job.ts` for why that means the browser must not wait for it.
 *
 * Filed under the system, because a designer teaches one dilemma at a time
 * inside one system. Starting another extraction there replaces this record.
 */

const DilemmaJobResultSchema = z.object({
  draft: DilemmaDraftSchema,
  /**
   * The interview the draft came out of, carried in the result on purpose.
   *
   * The conversation only ever lived in the browser. If the designer locks the
   * phone and comes back to a finished extraction, the page they return to has
   * no chat history — and the transcript is saved alongside the dilemma for
   * later audit. Carrying it here is what makes coming back actually work.
   */
  transcript: z.string(),
});

export type DilemmaJobResult = z.infer<typeof DilemmaJobResultSchema>;
export type DilemmaJob = Job<DilemmaJobResult>;

const record = jobRecord(DilemmaJobResultSchema);
const pathFor = (systemId: string) => systemPaths(systemId).dilemmaJob;

export function readDilemmaJob(systemId: string): Promise<DilemmaJob | null> {
  return record.read(pathFor(systemId));
}

export function startDilemmaJob(
  systemId: string,
  systemName: string,
): Promise<DilemmaJob> {
  return record.start(
    pathFor(systemId),
    `Start dilemma extraction: ${systemName}`,
  );
}

export function finishDilemmaJob(
  systemId: string,
  systemName: string,
  result: DilemmaJobResult,
): Promise<void> {
  return record.finish(
    pathFor(systemId),
    `Dilemma extracted: ${systemName}`,
    result,
  );
}

export function failDilemmaJob(
  systemId: string,
  systemName: string,
  error: string,
): Promise<void> {
  return record.fail(
    pathFor(systemId),
    `Dilemma extraction failed: ${systemName}`,
    error,
  );
}

/**
 * Forgets the extraction, once its draft has been saved.
 *
 * The record means "an extraction is waiting to be reviewed". Leaving a
 * finished one behind would greet the next visitor to this screen with a
 * dilemma they already saved.
 */
export function clearDilemmaJob(
  systemId: string,
  systemName: string,
): Promise<void> {
  return repoFiles().remove(
    pathFor(systemId),
    `Dilemma review finished: ${systemName}`,
  );
}

export { asReported, isStale };
