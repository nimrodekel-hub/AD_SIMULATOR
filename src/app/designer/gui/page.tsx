import { NotBuiltYet } from "@/components/not-built-yet";
import { ScreenShell } from "@/components/screen-shell";

export default function GuiBuilderPage() {
  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title="Simulated console"
      subtitle="Built once from reference screenshots"
    >
      <NotBuiltYet
        stage="Build stage 5"
        what="Upload 2–5 screenshots of a console, and the system generates a static look-alike interface for trainee runs to render inside. Until then, training runs use the plain text console."
      />
    </ScreenShell>
  );
}
