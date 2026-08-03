// S-37 Join
export default function JoinPage({ params }: { params: { joinCode: string } }) {
  return (
    <main data-testid="screen" data-screen="S-37">
      <h1>Joining {params.joinCode}</h1>
    </main>
  );
}
