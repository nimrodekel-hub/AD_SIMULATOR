import { ScreenShell } from "@/components/screen-shell";
import { TrainingRequest } from "@/components/training-request";
import { listTrainees } from "@/lib/store/sessions";

export const dynamic = "force-dynamic";

export default async function TraineePage({
  searchParams,
}: PageProps<"/trainee">) {
  const [trainees, query] = await Promise.all([listTrainees(), searchParams]);

  // An instructor can start a run for a specific trainee from their history
  // page. It pre-selects the console operator; it does not replace the
  // trainee's own ability to ask for training.
  const requested = typeof query.trainee === "string" ? query.trainee : undefined;
  const preselected = trainees.some((trainee) => trainee.id === requested)
    ? requested
    : undefined;

  return (
    <ScreenShell
      theme="ops"
      eyebrow="Trainee"
      title="Request training"
      subtitle="Ask for what you want to practise, in your own words"
      contained={false}
    >
      <TrainingRequest trainees={trainees} preselectedTraineeId={preselected} />
    </ScreenShell>
  );
}
