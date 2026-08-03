/**
 * Route skeletons ONLY. Screen implementation is prompt 09; a placeholder here
 * renders its screen id and title so the router, the gates and the Playwright
 * smoke test have something real to assert against.
 */
export function ScreenPlaceholder({ id, title }: { id: string; title: string }) {
  return (
    <main data-testid="screen" data-screen={id}>
      <h1>{title}</h1>
    </main>
  );
}
