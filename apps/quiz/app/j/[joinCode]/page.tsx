// S-37 Join
import { JoinScreen } from '../../../src/screens/join/join-screen.js';

export default function JoinPage({ params }: { params: { joinCode: string } }) {
  return <JoinScreen initialCode={params.joinCode} autoSubmit />;
}
