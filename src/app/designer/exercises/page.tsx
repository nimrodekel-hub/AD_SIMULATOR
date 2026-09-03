import Link from "next/link";
import { ScreenShell } from "@/components/screen-shell";
import { TakeHoldButton } from "@/components/take-hold-button";
import { listSystems } from "@/lib/store/kb";
import { listAllExercises } from "@/lib/store/exercises";
import { listAllSessions } from "@/lib/store/sessions";

/**
 * Every exercise the generator has produced.
 *
 * There was no such page, and its absence was a real hole: an exercise existed
 * only inside the run it was made for, so nobody could see what trainees had
 * actually been given, and a poor exercise could be found only by flying it.
 *
 * Two kinds are listed together, because a designer looking for a bad exercise
 * does not care which:
 *
 * - **Exercises in the library** — ones taken hold of to be corrected, and the
 *   corrected versions. These can be changed.
 * - **Exercises inside runs** — as generated for a trainee. These are records
 *   and are never rewritten: the debrief and the score describe what was
 *   actually flown. Correcting one copies it into the library first.
 */

export const dynamic = "force-dynamic";

export default async function ExercisesPage() {
  const [systems, saved, sessions] = await Promise.all([
    listSystems(),
    listAllExercises(),
    listAllSessions(),
  ]);

  const systemName = (id: string) =>
    systems.find((system) => system.id === id)?.name ?? "a deleted system";

  /* A run whose exercise has already been copied out is shown as such, so the
     designer is not offered the same copy twice. */
  const heldFrom = new Set(saved.map((entry) => entry.from_session_id));

  return (
    <ScreenShell
      theme="work"
      eyebrow="Designer"
      title="Exercises"
      subtitle="Every engagement the generator has laid out — and the ones you have corrected"
    >
      <p className="mb-8">
        <Link href="/designer" className="text-xs text-muted hover:text-accent">
          ← Back to the systems
        </Link>
      </p>

      {/* ---- The library -------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">In the library</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Exercises you have taken hold of. These can be flown, corrected in
          your own words, and corrected again.
        </p>

        {saved.length === 0 ? (
          <p className="panel mt-4 p-4 text-sm text-muted">
            Nothing here yet. Take hold of one of the exercises below and it
            appears here, where it can be changed.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {saved.map((entry) => (
              <li key={entry.id} className="panel p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/designer/exercises/${entry.id}?system=${entry.system_id}`}
                    className="text-sm font-semibold hover:text-accent"
                  >
                    {entry.exercise_instance.exercise_name || "Untitled exercise"}
                  </Link>
                  <span className="chip">{entry.difficulty_level}</span>
                  {entry.revisions.length > 0 ? (
                    <span className="chip status-ok">
                      {entry.revisions.length} correction
                      {entry.revisions.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {systemName(entry.system_id)} ·{" "}
                  {entry.exercise_instance.live_tracks.length} track
                  {entry.exercise_instance.live_tracks.length === 1 ? "" : "s"} ·{" "}
                  {entry.exercise_instance.time_window_seconds}s
                  {entry.source ? ` · ${entry.source}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Exercises as flown ------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold">As given to trainees</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          One exercise per run, exactly as it was generated. These are records
          and are not edited — the debrief and the score describe what was
          actually flown. To correct one, take hold of it: that copies it into
          the library and leaves the run alone.
        </p>

        {sessions.length === 0 ? (
          <p className="panel mt-4 p-4 text-sm text-muted">
            No trainee has been given an exercise yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {sessions.map((session) => (
              <li key={session.id} className="panel p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold">
                    {session.exercise_instance.exercise_name ||
                      "Untitled exercise"}
                  </span>
                  <span className="chip">{session.difficulty_level}</span>
                  <span
                    className={`chip ${
                      session.status === "completed"
                        ? "status-ok"
                        : "status-warn"
                    }`}
                  >
                    {session.status === "completed" ? "flown" : "not flown"}
                  </span>
                  {session.score !== null ? (
                    <span className="data text-xs text-muted">
                      scored {session.score}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {systemName(session.system_id)} ·{" "}
                  {session.exercise_instance.live_tracks.length} track
                  {session.exercise_instance.live_tracks.length === 1
                    ? ""
                    : "s"}{" "}
                  · {session.created_at.slice(0, 10)}
                  {session.requested_text ? ` · “${session.requested_text}”` : ""}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {heldFrom.has(session.id) ? (
                    <span className="text-xs text-muted">
                      Already copied into the library.
                    </span>
                  ) : (
                    <TakeHoldButton sessionId={session.id} />
                  )}
                  {session.status === "completed" ? (
                    <Link
                      href={`/instructor/${session.trainee_id}`}
                      className="text-xs text-muted hover:text-accent"
                    >
                      The debrief for this run →
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ScreenShell>
  );
}
