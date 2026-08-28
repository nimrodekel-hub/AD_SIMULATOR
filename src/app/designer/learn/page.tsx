import { LearningChat } from "@/components/learning-chat";
import { ScreenShell } from "@/components/screen-shell";

export default function LearnDilemmaPage() {
  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title="Teach a dilemma"
      subtitle="Talk it through; the system extracts the structured record"
    >
      <LearningChat />
    </ScreenShell>
  );
}
