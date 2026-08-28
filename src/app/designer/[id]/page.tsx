import { notFound } from "next/navigation";
import { DilemmaEditor } from "@/components/dilemma-editor";
import { ScreenShell } from "@/components/screen-shell";
import { getDilemma } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function DilemmaPage({
  params,
}: PageProps<"/designer/[id]">) {
  const { id } = await params;
  const entry = await getDilemma(id);
  if (!entry) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title={entry.title}
      subtitle={entry.sub_domain_tag}
    >
      <DilemmaEditor entry={entry} />
    </ScreenShell>
  );
}
