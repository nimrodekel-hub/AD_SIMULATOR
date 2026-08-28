import { NotBuiltYet } from "@/components/not-built-yet";
import { ScreenShell } from "@/components/screen-shell";

export default function TraineePage() {
  return (
    <ScreenShell theme="ops" eyebrow="Trainee" title="Request training">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <NotBuiltYet
          stage="Build stage 3"
          what="Ask for the training you want in plain language. The system matches it to a captured dilemma, asks a clarifying question if it is unsure, and generates a scenario at the right difficulty."
        />
      </div>
    </ScreenShell>
  );
}
