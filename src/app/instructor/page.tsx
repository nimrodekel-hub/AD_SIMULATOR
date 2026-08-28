import { NotBuiltYet } from "@/components/not-built-yet";
import { ScreenShell } from "@/components/screen-shell";

export default function InstructorPage() {
  return (
    <ScreenShell theme="ops" eyebrow="Instructor" title="Trainee overview">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <NotBuiltYet
          stage="Build stage 6"
          what="Every trainee's session history, scores and trend, with a drill-down into each decision they made and the debrief they received."
        />
      </div>
    </ScreenShell>
  );
}
