// S-38 Self-registration
export default function RegisterPage({ params }: { params: { joinCode: string } }) {
  return (
    <main data-testid="screen" data-screen="S-38">
      <h1>Join {params.joinCode}</h1>
    </main>
  );
}
