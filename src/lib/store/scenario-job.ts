import "server-only";
import { z } from "zod";
import { scenarioJobPath } from "../config";
import { type Job, asReported, isStale, jobRecord } from "./job";

/**
 * The record of one scenario being generated for a trainee.
 *
 * This is the one long wait a trainee sees, and the trainee is the person most
 * likely to be on a phone — so it is the wait that must survive a locked
 * screen. See `job.ts`.
 *
 * Filed under the trainee rather than the system: two trainees may be starting
 * runs on the same system at the same moment, but nobody runs two scenarios at
 * once, so one record per trainee is both correct and self-limiting.
 *
 * The result is only the session id. Everything the run needs is written into
 * the session itself before the job is marked done, so a finished job is a
 * pointer to something already complete.
 */

const ScenarioJobResultSchema = z.object({ session_id: z.string() });

export type ScenarioJobResult = z.infer<typeof ScenarioJobResultSchema>;
export type ScenarioJob = Job<ScenarioJobResult>;

const record = jobRecord(ScenarioJobResultSchema);

export function readScenarioJob(traineeId: string): Promise<ScenarioJob | null> {
  return record.read(scenarioJobPath(traineeId));
}

export function startScenarioJob(traineeId: string): Promise<ScenarioJob> {
  return record.start(
    scenarioJobPath(traineeId),
    `Start scenario generation for ${traineeId}`,
  );
}

export function finishScenarioJob(
  traineeId: string,
  result: ScenarioJobResult,
): Promise<void> {
  return record.finish(
    scenarioJobPath(traineeId),
    `Scenario ready for ${traineeId}`,
    result,
  );
}

export function failScenarioJob(
  traineeId: string,
  error: string,
): Promise<void> {
  return record.fail(
    scenarioJobPath(traineeId),
    `Scenario generation failed for ${traineeId}`,
    error,
  );
}

export { asReported, isStale };
