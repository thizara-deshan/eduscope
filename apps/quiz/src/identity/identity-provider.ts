import type { QuizIdentity } from '@eduscope/api-client/quiz';

export interface RegisterInput {
  readonly displayName: string;
  readonly studentIdNumber: string;
}

/**
 * The A-16 seam: "basic login now, SSO later". Everything student-identity
 * shaped goes through this interface, so adding `createSsoProvider` later is a
 * new file plus one changed call site — no page or component knows the
 * mechanism. The student ID is the leaderboard key today (INV-SI-1) and the SSO
 * identity tomorrow, which is why it is the field both implementations carry.
 */
export interface QuizIdentityProvider {
  readonly kind: 'self-registration' | 'sso';
  resolve(joinCode: string): Promise<QuizIdentity | null>;
  register(joinCode: string, input: RegisterInput): Promise<QuizIdentity>;
  signOut(): Promise<void>;
}
