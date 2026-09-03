import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleRehearsal } from "@/components/console-rehearsal";
import { ScreenShell } from "@/components/screen-shell";
import { readGuiJob } from "@/lib/store/gui-job";
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
 * Nothing is recorded. No model is called, no scenario is required, nobody is
 * scored.
 *
 * It is also where a console change is reviewed. A revision used to live only
 * in the builder's React state, so this page — which reads what is *stored* —
 * showed the version from before the change, and a builder that had done what
 * it was asked looked like one that had ignored it. The newest finished build
 * is kept with its job, so this page can run that instead and ask for a
 * verdict on it — after it has been flown, which is the run's business rather
 * than this page's.
 */

export const dynamic = "force-dynamic";

export default async function TestSystemPage({
  params,
}: PageProps<"/designer/systems/[systemId]/test">) {
  const { systemId } = await params;
  const [system, profile, template, job] = await Promise.all([
    getSystem(systemId),
    getSystemProfile(systemId),
    getGuiTemplate(systemId),
    readGuiJob(systemId),
  ]);
  if (!system) notFound();

  const stored = template?.generated_ui_code;

  /* A finished build that is not what is stored is a change the designer asked
     for and has not accepted yet — and it is the whole reason they are here.
     Running the stored console instead would show them their change missing. */
  const built = job?.status === "done" ? job.result : null;
  const review = built && built.html !== stored ? built : null;

  const html = review?.html ?? stored;
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

  /* Interrogation is off unless the profile says otherwise, and a profile
     approved before the question existed has it off without anyone ever
     having been asked. On a system that genuinely cannot interrogate, showing
     nothing is right. Here it is indistinguishable from a broken console —
     which is how a designer ends up hunting the readout for a figure that was
     never going to appear. So the page says which of the two it is. */
  const canInterrogate = profile.iff_interrogation?.enabled === true;

  return (
    <ScreenShell
      theme="ops"
      eyebrow={`${system.name} · test`}
      title="Test the system"
      contained={false}
      fullHeight
    >
      {hostsTheScope && canInterrogate ? null : (
        <div className="flex flex-col items-start gap-2 px-6 pt-4">
          {hostsTheScope ? null : (
            <p className="chip status-warn !normal-case">
              {html
                ? "This console has no radar-picture slot, so the test is running in the built-in layout instead. Ask the builder for a scope area and try again."
                : "No console has been built for this system yet, so the test is running in the built-in layout. The behaviour under test is the same either way."}
            </p>
          )}
          {canInterrogate ? null : (
            <p className="chip !normal-case">
              This system declares no IFF interrogator, so there is no IFF
              reading on a locked track and no interrogate command.{" "}
              <Link
                href={`/designer/systems/${systemId}/profile`}
                className="underline"
              >
                Turn it on in the profile
              </Link>{" "}
              — and say which track classes reply — to see transponder codes
              here.
            </p>
          )}
        </div>
      )}

      {/* The review travels *into* the run rather than sitting above it: the
          verdict on a change belongs after it has been flown, and the run is
          what knows when that has happened. */}
      <ConsoleRehearsal
        systemId={systemId}
        profile={profile}
        templateHtml={hostsTheScope ? html : undefined}
        review={
          review
            ? {
                html: review.html,
                screenshots: review.screenshots,
                requests: review.requests,
                designNotes: review.design_notes,
                missingSlots: review.missing_slots,
                storedRevisions: template?.revisions ?? [],
                wasApproved: template?.approved === true,
              }
            : undefined
        }
      />
    </ScreenShell>
  );
}
