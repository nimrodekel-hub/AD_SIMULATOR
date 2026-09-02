import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleRehearsal } from "@/components/console-rehearsal";
import { ScreenShell } from "@/components/screen-shell";
import { getGuiTemplate, getSystem, getSystemProfile } from "@/lib/store/kb";

/**
 * Setup step 4 — flying the system yourself, before any trainee does.
 *
 * This is the designer sitting at their own console with things moving on it.
 * It answers the questions nothing earlier in the sequence can: whether the
 * detection range gives an operator any warning at all, whether the interceptor
 * actually catches what the profile says it catches, whether the track list
 * holds its rows, whether the scope stays square with a radar drawn in it, and
 * whether the fire controls survive a firing solution appearing beside them.
 *
 * It needs **only the behaviour profile**. A console makes the test look like
 * the real thing, and its absence is worth saying out loud — but a system whose
 * numbers have never been flown is the thing actually worth catching, so the
 * test opens the moment a profile exists, draft included.
 *
 * Nothing is recorded. No model is called, no dilemma is required, nobody is
 * scored.
 */

export const dynamic = "force-dynamic";

export default async function TestSystemPage({
  params,
}: PageProps<"/designer/systems/[systemId]/test">) {
  const { systemId } = await params;
  const [system, profile, template] = await Promise.all([
    getSystem(systemId),
    getSystemProfile(systemId),
    getGuiTemplate(systemId),
  ]);
  if (!system) notFound();

  const html = template?.generated_ui_code;
  /* Without a scope slot there is nowhere to draw the radar, so the run falls
     back to the built-in operations layout. Saying so here stops the designer
     concluding their console is broken when what is missing is one slot. */
  const hostsTheScope = html?.includes('data-slot="scope"') === true;

  /* The one hard requirement. Everything in the simulation — detection range,
     the covered arc, the classes that can appear, what a round can reach — is
     read from the profile, so without one there is nothing to test. */
  if (!profile) {
    return (
      <ScreenShell
        theme="work"
        eyebrow={system.name}
        title="Nothing to test yet"
        subtitle="Describe how the system behaves first"
      >
        <div className="panel p-6">
          <p className="text-sm leading-relaxed">
            The test flies real targets at {system.name} using its own figures:
            what the radar sees, what the interceptors can reach, which
            identification states exist. Those come from the behaviour profile,
            so it has to be filled in first — a draft is enough.
          </p>
          <Link
            href={`/designer/systems/${systemId}/profile`}
            className="btn btn-primary mt-4"
          >
            Describe the system
          </Link>
        </div>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      theme="ops"
      eyebrow={`${system.name} · test`}
      title="Test the system"
      contained={false}
      fullHeight
    >
      {hostsTheScope ? null : (
        <div className="px-6 pt-4">
          <p className="chip status-warn !normal-case">
            {html
              ? "This console has no radar-picture slot, so the test is running in the built-in layout instead. Ask the builder for a scope area and try again."
              : "No console has been built for this system yet, so the test is running in the built-in layout. The behaviour under test is the same either way."}
          </p>
        </div>
      )}

      <ConsoleRehearsal
        systemId={systemId}
        profile={profile}
        templateHtml={hostsTheScope ? html : undefined}
      />
    </ScreenShell>
  );
}
