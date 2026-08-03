// S-39/S-40/S-41 are STATES of this one route, not separate routes
// (screen-inventory §1.2).
export default function PlayPage({ params }: { params: { quizSessionId: string } }) {
  return (
    <main data-testid="screen" data-screen="S-39">
      <h1>Waiting for your lecturer&rsquo;s next question</h1>
      <p hidden>{params.quizSessionId}</p>
    </main>
  );
}
