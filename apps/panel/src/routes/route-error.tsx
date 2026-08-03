import { useRouteError } from 'react-router';

/**
 * A kiosk has no keyboard, no address bar and nobody to press reload — an
 * unhandled render error must not become a white screen in a lecture hall.
 * Recording continues regardless: the device is the authority, not the browser
 * (state-machines §5.5).
 */
export function RouteError() {
  const error = useRouteError();
  return (
    <main data-testid="route-error" role="alert">
      <h1>Something went wrong on this screen</h1>
      <p>Recording is not affected. Go back to the dashboard and try again.</p>
      <a href="/">Back to dashboard</a>
      <pre hidden>{error instanceof Error ? error.message : String(error)}</pre>
    </main>
  );
}
