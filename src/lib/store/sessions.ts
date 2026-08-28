import "server-only";
import type { Row } from "@libsql/client";
import { db, fromJson } from "../db";
import type {
  ClarificationRound,
  DecisionMade,
  Debrief,
  DifficultyLevel,
  ScenarioInstance,
  Session,
  Trainee,
} from "../domain/schemas";

/**
 * Session log: every training run, the decisions taken during it, and the
 * debrief it produced. This is the instructor's evidence base.
 */

function toSession(row: Row): Session {
  return {
    id: String(row.id),
    trainee_id: String(row.trainee_id),
    dilemma_entry_id: String(row.dilemma_entry_id),
    requested_text: String(row.requested_text),
    clarification_rounds: fromJson<ClarificationRound[]>(row.clarification_rounds, []),
    difficulty_level: String(row.difficulty_level) as DifficultyLevel,
    scenario_instance: fromJson<ScenarioInstance>(
      row.scenario_instance,
      {} as ScenarioInstance,
    ),
    decisions_made: fromJson<DecisionMade[]>(row.decisions_made, []),
    outcome: fromJson<Session["outcome"]>(row.outcome, null),
    score: row.score === null ? null : Number(row.score),
    debrief_text: String(row.debrief_text ?? ""),
    recommendations: fromJson<string[]>(row.recommendations, []),
    status: String(row.status) as Session["status"],
    created_at: String(row.created_at),
    completed_at: row.completed_at === null ? null : String(row.completed_at),
  };
}

export async function createSession(input: {
  traineeId: string;
  dilemmaEntryId: string;
  requestedText: string;
  clarificationRounds: ClarificationRound[];
  difficulty: DifficultyLevel;
  scenario: ScenarioInstance;
}): Promise<Session> {
  const client = await db();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await client.execute({
    sql: `INSERT INTO sessions
            (id, trainee_id, dilemma_entry_id, requested_text, clarification_rounds,
             difficulty_level, scenario_instance, decisions_made, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'in_progress', ?)`,
    args: [
      id,
      input.traineeId,
      input.dilemmaEntryId,
      input.requestedText,
      JSON.stringify(input.clarificationRounds),
      input.difficulty,
      JSON.stringify(input.scenario),
      createdAt,
    ],
  });

  const created = await getSession(id);
  if (!created) throw new Error("Session vanished immediately after insert");
  return created;
}

export async function getSession(id: string): Promise<Session | null> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM sessions WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  return row ? toSession(row) : null;
}

export async function recordDecisions(
  id: string,
  decisions: DecisionMade[],
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "UPDATE sessions SET decisions_made = ? WHERE id = ?",
    args: [JSON.stringify(decisions), id],
  });
}

/** Writes the debrief and closes the session. */
export async function completeSession(
  id: string,
  debrief: Debrief,
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE sessions
             SET outcome = ?, score = ?, debrief_text = ?, recommendations = ?,
                 status = 'completed', completed_at = ?
           WHERE id = ?`,
    args: [
      JSON.stringify(debrief.outcome),
      debrief.score,
      debrief.debrief_text,
      JSON.stringify(debrief.recommendations),
      new Date().toISOString(),
      id,
    ],
  });
}

export async function listSessionsForTrainee(traineeId: string): Promise<Session[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM sessions WHERE trainee_id = ? ORDER BY created_at DESC",
    args: [traineeId],
  });
  return result.rows.map(toSession);
}

export async function listAllSessions(): Promise<Session[]> {
  const client = await db();
  const result = await client.execute(
    "SELECT * FROM sessions ORDER BY created_at DESC",
  );
  return result.rows.map(toSession);
}

/* ------------------------------------------------------------------ */
/* Trainees                                                            */
/* ------------------------------------------------------------------ */

export async function listTrainees(): Promise<Trainee[]> {
  const client = await db();
  const result = await client.execute("SELECT * FROM trainees ORDER BY name");
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    notes: String(row.notes ?? ""),
    created_at: String(row.created_at),
  }));
}

export async function getTrainee(id: string): Promise<Trainee | null> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM trainees WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    notes: String(row.notes ?? ""),
    created_at: String(row.created_at),
  };
}
