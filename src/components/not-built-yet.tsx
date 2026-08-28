/**
 * Placeholder for a screen scheduled for a later build stage.
 *
 * Present so the navigation is honest: the route exists, and it says what is
 * coming rather than 404-ing on a link the home screen offers.
 */
export function NotBuiltYet({ stage, what }: { stage: string; what: string }) {
  return (
    <div className="panel p-8 text-center">
      <span className="chip status-warn">{stage}</span>
      <p className="mx-auto mt-4 max-w-md text-sm text-muted">{what}</p>
    </div>
  );
}
