import "server-only";
import { DATA_PATHS } from "../config";
import {
  SessionSchema,
  TraineeSchema,
  type ClarificationRound,
  type Debrief,
  type DifficultyLevel,
  type RunResult,
  type SimEvent,
  type ExerciseInstance,
  type Session,
  type Trainee,
} from "../domain/schemas";
import { repoFiles } from "./repo-files";
import { outcomeOf } from "../domain/run-outcome";
import { currentNames } from "../domain/stored-names";

/**
 * Session log: every training run, the decisions taken during it, and the
 * debrief it produced. This is the instructor's evidence base.
 *
 * Stored the same way as the knowledge base — one JSON file per run in the
 * repository — so the whole system has exactly one storage mechanism and no
 * external database to provision. A run costs a handful of commits, which is
 * fine at the scale this is built for and gives every training run a permanent,
 * inspectable record.
 */

const fileFor = (id: string) => `${DATA_PATHS.sessions}/${id}.json`;

function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export async function createSession(input: {
  traineeId: string;
  systemId: string;
  scenarioEntryId: string;
  requestedText: string;
  clarificationRounds: ClarificationRound[];
  difficulty: DifficultyLevel;
  exercise: ExerciseInstance;
  /** What the generator had to override to fit the system. Shown in the brief. */
  adjustments?: string[];
}): Promise<Session> {
  const session: Session = {
    id: crypto.randomUUID(),
    trainee_id: input.traineeId,
    system_id: input.systemId,
    scenario_entry_id: input.scenarioEntryId,
    requested_text: input.requestedText,
    clarification_rounds: input.clarificationRounds,
    difficulty_level: input.difficulty,
    exercise_instance: input.exercise,
    exercise_adjustments: input.adjustments ?? [],
    decisions_made: [],
    run_log: [],
    run_result: null,
    outcome: null,
    score: null,
    debrief_text: "",
    recommendations: [],
    status: "in_progress",
    created_at: new Date().toISOString(),
    completed_at: null,
  };

  await save(session, `Start training run ${session.id.slice(0, 8)}`);
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  const raw = await repoFiles().read(fileFor(id));
  if (raw === null) return null;

  const parsed = SessionSchema.safeParse(currentNames(JSON.parse(raw)));
  if (!parsed.success) {
    // One malformed run must not break the instructor's whole history view.
    console.error(`Skipping malformed session ${id}:`, parsed.error.message);
    return null;
  }
  return parsed.data;
}

async function save(session: Session, message: string): Promise<void> {
  await repoFiles().write(
    fileFor(session.id),
    serialise(SessionSchema.parse(session)),
    message,
  );
}

/**
 * Closes a run on the strength of what the engine counted, and nothing else.
 *
 * This is what "the run is over" means: the clock stopped, the tally is in,
 * and the trainee is owed the result. It used to mean something else — a run
 * became `completed` only when a model had finished writing about it, so an
 * assessment that failed left a finished engagement recorded as unfinished
 * work and showed the trainee "this run has not been completed yet" after
 * they had destroyed every hostile.
 *
 * One save rather than two. The log, the tally and the objective outcome are
 * known at the same instant and every save here is a commit, so writing them
 * separately bought a second commit and a window in which the record was
 * half-written.
 */
export async function concludeRun(
  id: string,
  log: SimEvent[],
  result: RunResult,
): Promise<void> {
  const session = await getSession(id);
  if (!session) return;
  await save(
    {
      ...session,
      run_log: log,
      run_result: result,
      outcome: outcomeOf(result, session.exercise_instance.success_criteria),
      /* Deliberately not scored. A number here would be this file's invention
         competing with the scenario's own rubric, which is the model's to
         apply — so the objective close leaves the score empty and the
         assessment fills it in. */
      status: "completed",
      completed_at: new Date().toISOString(),
    },
    `Conclude run ${id.slice(0, 8)} — ${result.met_criteria ? "met" : "missed"} criteria`,
  );
}

/**
 * Attaches the written assessment to a run that is already closed.
 *
 * Its outcome replaces the objective one because it is the same verdict with
 * the reasoning attached — the model is given the engine's tally and grades
 * against the scenario's own rubric, so it cannot disagree about what
 * happened, only add why it mattered.
 */
export async function completeSession(
  id: string,
  debrief: Debrief,
): Promise<void> {
  const session = await getSession(id);
  if (!session) return;

  await save(
    {
      ...session,
      outcome: debrief.outcome,
      score: debrief.score,
      debrief_text: debrief.debrief_text,
      recommendations: debrief.recommendations,
      status: "completed",
      completed_at: new Date().toISOString(),
    },
    `Complete run ${id.slice(0, 8)} — scored ${Math.round(debrief.score)}`,
  );
}

export async function listAllSessions(): Promise<Session[]> {
  const files = await repoFiles().list(DATA_PATHS.sessions);
  const sessions = await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map((name) => getSession(name.replace(/\.json$/, ""))),
  );

  return sessions
    .filter((session): session is Session => session !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listSessionsForTrainee(
  traineeId: string,
): Promise<Session[]> {
  return (await listAllSessions()).filter(
    (session) => session.trainee_id === traineeId,
  );
}

/* ------------------------------------------------------------------ */
/* Trainees                                                            */
/* ------------------------------------------------------------------ */

/**
 * The POC has no sign-up flow, so the roster is a fixed default until someone
 * edits it. Ids are literal rather than generated: sessions reference them, so
 * they have to stay identical across requests and deploys.
 */
const DEFAULT_ROSTER: Trainee[] = [
  { id: "trainee-a", name: "Trainee A — Ops Console 1", notes: "", created_at: "" },
  { id: "trainee-b", name: "Trainee B — Ops Console 2", notes: "", created_at: "" },
  { id: "trainee-c", name: "Trainee C — Ops Console 3", notes: "", created_at: "" },
];

export async function listTrainees(): Promise<Trainee[]> {
  const raw = await repoFiles().read(DATA_PATHS.trainees);
  // No file yet is the normal first-run state, not an error — fall back to the
  // default roster rather than writing one on a page load nobody asked to save.
  if (raw === null) return DEFAULT_ROSTER;

  const parsed = TraineeSchema.array().safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Malformed trainee roster, using defaults:", parsed.error.message);
    return DEFAULT_ROSTER;
  }
  return parsed.data;
}

export async function getTrainee(id: string): Promise<Trainee | null> {
  return (await listTrainees()).find((trainee) => trainee.id === id) ?? null;
}

export async function saveTrainees(trainees: Trainee[]): Promise<void> {
  await repoFiles().write(
    DATA_PATHS.trainees,
    serialise(TraineeSchema.array().parse(trainees)),
    "Update trainee roster",
  );
}
