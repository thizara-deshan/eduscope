// S-37 Join — `/j` is the manual-entry alias (W7-D-1); no auto-submit.
import { JoinScreen } from '../../src/screens/join/join-screen.js';

export default function JoinManualPage() {
  return <JoinScreen initialCode="" autoSubmit={false} />;
}
