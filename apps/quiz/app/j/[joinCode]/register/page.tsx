// S-38 Self-registration
import { RegistrationScreen } from '../../../../src/screens/registration/registration-screen.js';

export default function RegisterPage({ params }: { params: { joinCode: string } }) {
  return <RegistrationScreen joinCode={params.joinCode} />;
}
