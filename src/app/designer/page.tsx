import Link from "next/link";
import { ScreenShell } from "@/components/screen-shell";
import { getGuiTemplate, listDilemmas } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function DesignerHome() {
  const [dilemmas, gui] = await Promise.all([listDilemmas(), getGuiTemplate()]);

  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title="Knowledge base"
      subtitle="Dilemmas the system can generate training from"
      actions={
        <Link href="/designer/learn" className="btn btn-primary">
          Teach a dilemma
        </Link>
      }
    >
      {dilemmas.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-sm">Nothing captured yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Teaching a dilemma is a conversation: describe the situation the way
            you would to a new operator, and the system will extract a
            structured record for you to correct and approve.
          </p>
          <Link href="/designer/learn" className="btn btn-primary mt-6">
            Start the first one
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {dilemmas.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/designer/${entry.id}`}
                className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:border-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{entry.title}</p>
                  <p className="data mt-1 truncate text-xs text-muted">
                    {entry.sub_domain_tag} · {entry.decision_points.length}{" "}
                    decision point
                    {entry.decision_points.length === 1 ? "" : "s"}
                  </p>
                </div>
                <span
                  className={`chip ${
                    entry.status === "approved" ? "status-ok" : "status-warn"
                  }`}
                >
                  {entry.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-sm font-semibold">Simulated console</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          The interface trainees see during a run. Built once from reference
          screenshots and reused for every scenario.
        </p>
        <div className="panel mt-4 flex flex-wrap items-center gap-4 p-4">
          <div className="flex-1">
            <p className="text-sm">
              {gui ? gui.system_name_fictional : "Not built yet"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {gui
                ? gui.approved
                  ? "Approved and in use."
                  : "Draft — not yet in use."
                : "Training runs currently use the plain text console."}
            </p>
          </div>
          <Link href="/designer/gui" className="btn">
            {gui ? "Review template" : "Build template"}
          </Link>
        </div>
      </section>
    </ScreenShell>
  );
}
