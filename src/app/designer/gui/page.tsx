import { GuiBuilder } from "@/components/gui-builder";
import { ScreenShell } from "@/components/screen-shell";
import { getGuiTemplate } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function GuiBuilderPage() {
  const existing = await getGuiTemplate();

  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title="Simulated console"
      subtitle="Built once from reference screenshots, then used by every run"
    >
      <GuiBuilder existing={existing} />
    </ScreenShell>
  );
}
