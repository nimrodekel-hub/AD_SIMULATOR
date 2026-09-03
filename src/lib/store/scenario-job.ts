import "server-only";
import { z } from "zod";
import { systemPaths } from "../config";
import { repoFiles } from "./repo-files";
import { ScenarioDraftSchema } from "../domain/schemas";
import { type Job, asReported, isStale, jobRecord } from "./job";

/**
 * The record of one scenario being extracted from an interview.
 *
 * Reading a whole interview and turning it into a structured record takes
 * well over a minute — measured against production, longer than the console
 * build. See `job.ts` for why that means the browser must not wait for it.
 *
 * Filed under the system, because a designer teaches one scenario at a time
 * inside one system. Starting another extraction there replaces this record.
 */

const ScenarioJobResultSchema = z.object({
  draft: ScenarioDraftSchema,
  /**
   * The interview the draft came out of, carried in the result on purpose.
   *
   * The conversation only ever lived in the browser. If the designer locks the
   * phone and comes back to a finished extraction, the page they return to has
   * no chat history — and the transcript is saved alongside the scenario for
   * later audit. Carrying it here is what makes coming back actually work.
   */
  transcript: z.string(),
});

export type ScenarioJobResult = z.infer<typeof ScenarioJobResultSchema>;
export type ScenarioJob = Job<ScenarioJobResult>;

const record = jobRecord(ScenarioJobResultSchema);
const pathFor = (systemId: string) => systemPaths(systemId).scenarioJob;

export function readScenarioJob(systemId: string): Promise<ScenarioJob | null> {
  return record.read(pathFor(systemId));
}

export function startScenarioJob(
  systemId: string,
  systemName: string,
): Promise<ScenarioJob> {
  return record.start(
    pathFor(systemId),
    `Start scenario extraction: ${systemName}`,
  );
}

export function finishScenarioJob(
  systemId: string,
  systemName: string,
  result: ScenarioJobResult,
): Promise<void> {
  return record.finish(
    pathFor(systemId),
    `Scenario extracted: ${systemName}`,
    result,
  );
}

export function failScenarioJob(
  systemId: string,
  systemName: string,
  error: string,
): Promise<void> {
  return record.fail(
    pathFor(systemId),
    `Scenario extraction failed: ${systemName}`,
    error,
  );
}

/**
 * Forgets the extraction, once its draft has been saved.
 *
 * The record means "an extraction is waiting to be reviewed". Leaving a
 * finished one behind would greet the next visitor to this screen with a
 * scenario they already saved.
 */
export function clearScenarioJob(
  systemId: string,
  systemName: string,
): Promise<void> {
  return repoFiles().remove(
    pathFor(systemId),
    `Scenario review finished: ${systemName}`,
  );
}

export { asReported, isStale };
