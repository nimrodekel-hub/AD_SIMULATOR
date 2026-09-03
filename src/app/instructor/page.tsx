import Link from "next/link";
import { ScoreSparkline } from "@/components/score-trend";
import { ScreenShell } from "@/components/screen-shell";
import { scoreTone, summarise } from "@/lib/stats";
import { listAllSessions, listTrainees } from "@/lib/store/sessions";

/**
 * Screen 2 — the instructor's board.
 *
 * Operations-room density: one row per trainee, everything at a glance, and a
 * way into the detail. Read while scanning for who needs attention.
 */

export const dynamic = "force-dynamic";

export default async function InstructorPage() {
  const [trainees, sessions] = await Promise.all([
    listTrainees(),
    listAllSessions(),
  ]);

  const rows = trainees.map((trainee) => ({
    trainee,
    stats: summarise(
      sessions.filter((session) => session.trainee_id === trainee.id),
    ),
  }));

  const totalRuns = sessions.length;

  return (
    <ScreenShell
      theme="ops"
      eyebrow="Instructor"
      title="Trainee overview"
      subtitle={`${trainees.length} on the roster · ${totalRuns} run${totalRuns === 1 ? "" : "s"} logged`}
      contained={false}
    >
      <div className="p-4">
        {totalRuns === 0 ? (
          <div className="panel p-8 text-center">
            <p className="text-sm">No training runs yet.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Scores, trends and decision histories appear here once trainees
              start running exercises.
            </p>
          </div>
        ) : null}

        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[52rem] text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <Th>TRAINEE</Th>
                <Th right>RUNS</Th>
                <Th right>LATEST</Th>
                <Th right>AVERAGE</Th>
                <Th right>VS PREVIOUS</Th>
                <Th>TREND</Th>
                <Th right>SUCCESS</Th>
                <Th right>LAST RUN</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ trainee, stats }) => (
                <tr key={trainee.id} className="border-b border-line/60">
                  <td className="px-3 py-3">
                    <Link
                      href={`/instructor/${trainee.id}`}
                      className="font-medium transition-colors hover:text-accent"
                    >
                      {trainee.name}
                    </Link>
                  </td>
                  <Td right>
                    {stats.completed}
                    {stats.runs > stats.completed ? (
                      <span className="text-muted">
                        {" "}
                        (+{stats.runs - stats.completed} open)
                      </span>
                    ) : null}
                  </Td>
                  <td className="px-3 py-3 text-right">
                    {stats.latest === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={`chip status-${scoreTone(stats.latest)}`}>
                        {Math.round(stats.latest)}
                      </span>
                    )}
                  </td>
                  <Td right>
                    {stats.average === null ? "—" : Math.round(stats.average)}
                  </Td>
                  <td className="px-3 py-3 text-right">
                    <Delta value={stats.delta} />
                  </td>
                  <td className="px-3 py-3">
                    <ScoreSparkline scores={stats.scores} />
                  </td>
                  <Td right>
                    {stats.successRate === null
                      ? "—"
                      : `${Math.round(stats.successRate * 100)}%`}
                  </Td>
                  <Td right>
                    {stats.lastRunAt
                      ? new Date(stats.lastRunAt).toLocaleDateString()
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-muted">
          Only completed runs are scored. An abandoned run is counted but not
          averaged — it has no score, and treating it as zero would punish a
          trainee for closing a tab.
        </p>
      </div>
    </ScreenShell>
  );
}

/**
 * Latest run against the average of everything before it. Up is good here, so
 * the direction and the sentiment agree.
 */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;

  const rounded = Math.round(value);
  if (Math.abs(rounded) < 1) {
    return <span className="data text-muted">±0</span>;
  }

  return (
    <span className={`data ${rounded > 0 ? "text-ok" : "text-danger"}`}>
      {rounded > 0 ? "▲" : "▼"} {Math.abs(rounded)}
    </span>
  );
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em] ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <td className={`data px-3 py-3 ${right ? "text-right" : "text-left"}`}>
      {children}
    </td>
  );
}
