import "server-only";
import {
  SavedScenarioSchema,
  type DifficultyLevel,
  type Revision,
  type SavedScenario,
  type ScenarioInstance,
} from "../domain/schemas";
import { systemPaths } from "../config";
import { listSystems } from "./kb";
import { repoFiles } from "./repo-files";

/**
 * The library of exercises.
 *
 * Until this existed, every scenario the generator produced lived in exactly
 * one place — the session of the trainee it was made for — which meant nobody
 * could see what had been generated, and a poor exercise could be discovered
 * only by flying it and corrected not at all.
 *
 * A record here is a scenario someone took hold of: lifted out of a run to be
 * corrected, or the correction itself. Sessions are never written to from
 * here. A finished run's debrief and score describe what was actually flown,
 * so revising it produces a record of its own and leaves the run intact.
 *
 * Filed under the system, like dilemmas and for the same reason: a scenario is
 * only meaningful inside the system whose profile bounds it, and reading one
 * system's library should be one directory listing rather than a scan.
 */

const pathFor = (systemId: string, scenarioId: string) =>
  `${systemPaths(systemId).scenarios}/${scenarioId}.json`;

export async function getSavedScenario(
  systemId: string,
  scenarioId: string,
): Promise<SavedScenario | null> {
  const raw = await repoFiles().read(pathFor(systemId, scenarioId));
  if (!raw) return null;
  const parsed = SavedScenarioSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function saveScenario(
  scenario: SavedScenario,
  message: string,
): Promise<void> {
  await repoFiles().write(
    pathFor(scenario.system_id, scenario.id),
    JSON.stringify(scenario, null, 2),
    message,
  );
}

/** One system's library, newest first. */
export async function listScenariosForSystem(
  systemId: string,
): Promise<SavedScenario[]> {
  const names = await repoFiles().list(systemPaths(systemId).scenarios);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) => getSavedScenario(systemId, name.replace(/\.json$/, ""))),
  );
  return records
    .filter((entry): entry is SavedScenario => entry !== null)
    .sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
    );
}

/**
 * Every saved scenario, across every system.
 *
 * A designer reviewing the exercises their trainees will be given is thinking
 * about the exercises, not about which directory each one is filed in — so the
 * library has one front door. The per-system read above is what the system's
 * own pages use.
 */
export async function listAllScenarios(): Promise<SavedScenario[]> {
  const systems = await listSystems();
  const perSystem = await Promise.all(
    systems.map((system) => listScenariosForSystem(system.id)),
  );
  return perSystem
    .flat()
    .sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
    );
}

/** A fresh record, for a scenario being taken hold of or newly produced. */
export function newScenario(input: {
  systemId: string;
  dilemmaEntryId: string;
  difficulty: DifficultyLevel;
  scenario: ScenarioInstance;
  source: string;
  fromSessionId?: string;
  revisions?: Revision[];
}): SavedScenario {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    system_id: input.systemId,
    dilemma_entry_id: input.dilemmaEntryId,
    difficulty_level: input.difficulty,
    scenario_instance: input.scenario,
    revisions: input.revisions ?? [],
    source: input.source,
    from_session_id: input.fromSessionId ?? "",
    created_at: now,
    updated_at: now,
  };
}
