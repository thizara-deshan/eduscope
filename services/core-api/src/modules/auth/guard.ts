import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProblemError } from '../../contracts/problem.js';
import type { AuthContext, AuthService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

/** Operations reachable while `mustResetPassword` is true (openapi.yaml Conventions → Auth, INV-U-3). */
const RESET_ALLOWLIST = new Set(['changePassword', 'getMe', 'logout']);

/**
 * Bearer-token guard shared by every authenticated route. `operationId` gates
 * the forced-reset allowlist; it is supplied per-route, not introspected, so
 * this stays independent of Fastify route-config internals.
 */
export function requireAuth(authService: AuthService, operationId: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ProblemError(401, 'auth.invalid-credentials', 'Missing bearer token');
    }

    const context = await authService.authenticate(header.slice('Bearer '.length));
    request.authContext = context;

    if (context.mustResetPassword && !RESET_ALLOWLIST.has(operationId)) {
      throw new ProblemError(403, 'auth.password-reset-required', 'Password reset required');
    }
  };
}
