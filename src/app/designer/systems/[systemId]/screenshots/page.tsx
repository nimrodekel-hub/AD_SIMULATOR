import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenshotUploader } from "@/components/screenshot-uploader";
import { ScreenShell } from "@/components/screen-shell";
import { getSystem, listScreenshots } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function ScreenshotsPage({
  params,
}: PageProps<"/designer/systems/[systemId]/screenshots">) {
  const { systemId } = await params;
  const [system, stored] = await Promise.all([
    getSystem(systemId),
    listScreenshots(systemId),
  ]);
  if (!system) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title="Reference screenshots"
      subtitle="Uploaded once, read twice: when your answers are interpreted, and when the console is built"
    >
      <p className="mb-8">
        <Link
          href={`/designer/systems/${systemId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← {system.name}
        </Link>
      </p>

      <div className="panel mb-8 p-4">
        <p className="prose-block text-sm">
          These come first because the next step asks what your display shows —
          which columns, in what order, in what units, and what each
          identification colour means. Those are far easier to get right when
          the display itself is on the table, so the screenshots are read
          alongside your answers rather than only afterwards.
        </p>
        <p className="mt-3 text-xs text-muted">
          They are evidence about the display, not authority about the system. A
          screenshot shows one moment: where it disagrees with what you write,
          what you write wins, and the disagreement is written down rather than
          quietly resolved.
        </p>
      </div>

      <ScreenshotUploader
        systemId={systemId}
        systemName={system.name}
        stored={stored}
      />
    </ScreenShell>
  );
}
