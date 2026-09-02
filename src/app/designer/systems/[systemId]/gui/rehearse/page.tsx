import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleRehearsal } from "@/components/console-rehearsal";
import { ScreenShell } from "@/components/screen-shell";
import { getGuiTemplate, getSystem, getSystemProfile } from "@/lib/store/kb";

/**
 * Flying targets on the console the designer just built.
 *
 * The builder's preview is an empty shell, which answers whether the panels
 * are in the right places and nothing else. It cannot say whether the track
 * list holds its rows, whether the scope is still square once a radar is drawn
 * in it, or whether the fire controls survive a firing solution appearing
 * beside them. Those only show up with things moving.
 *
 * It runs on a draft as readily as on an approved console — testing before
 * approving is the entire point — and writes nothing at all.
 */

export const dynamic = "force-dynamic";

export default async function RehearsePage({
  params,
}: PageProps<"/designer/systems/[systemId]/gui/rehearse">) {
  const { systemId } = await params;
  const [system, profile, template] = await Promise.all([
    getSystem(systemId),
    getSystemProfile(systemId),
    getGuiTemplate(systemId),
  ]);
  if (!system) notFound();

  const html = template?.generated_ui_code;
  // Without a scope slot there is nowhere to draw the radar, and the run falls
  // back to the built-in layout. Saying so here stops the designer concluding
  // their console is broken when what is missing is one slot.
  const hostsTheScope = html?.includes('data-slot="scope"') === true;

  if (!html) {
    return (
      <ScreenShell
        theme="work"
        eyebrow={system.name}
        title="Nothing to rehearse yet"
        subtitle="Build the console first"
      >
        <div className="panel p-6">
          <p className="text-sm">
            {system.name} has no console yet. Build one and come back — this
            page flies targets on it so you can see the panels behave with real
            data in them.
          </p>
          <Link
            href={`/designer/systems/${systemId}/gui`}
            className="btn btn-primary mt-4"
          >
            Build the console
          </Link>
        </div>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      theme="ops"
      eyebrow={`${system.name} · rehearsal`}
      title="Console rehearsal"
      contained={false}
      fullHeight
    >
      {hostsTheScope ? null : (
        <div className="px-6 pt-4">
          <p className="chip status-warn !normal-case">
            This console has no radar-picture slot, so the rehearsal is running
            in the built-in layout instead. Ask the builder for a
            <code className="mx-1">scope</code> area and try again.
          </p>
        </div>
      )}

      <ConsoleRehearsal
        systemId={systemId}
        profile={profile?.approved ? profile : (profile ?? null)}
        templateHtml={hostsTheScope ? html : undefined}
      />
    </ScreenShell>
  );
}
