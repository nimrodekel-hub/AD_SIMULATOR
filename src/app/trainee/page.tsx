import { ScreenShell } from "@/components/screen-shell";
import { TrainingRequest } from "@/components/training-request";
import { listTrainees } from "@/lib/store/sessions";

export const dynamic = "force-dynamic";

export default async function TraineePage() {
  const trainees = await listTrainees();

  return (
    <ScreenShell
      theme="ops"
      eyebrow="Trainee"
      title="Request training"
      subtitle="Ask for what you want to practise, in your own words"
      contained={false}
    >
      <TrainingRequest trainees={trainees} />
    </ScreenShell>
  );
}
