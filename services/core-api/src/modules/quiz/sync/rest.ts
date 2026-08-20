import { readFileSync } from 'node:fs';
import { z } from 'zod';

const zQuizCredentialFile = z.object({ quizDeviceCredential: z.string().nullable().default(null) }).passthrough();

/**
 * Reads the deploy-minted per-device static bearer (DR-03, quiz-service.md
 * §6.2) that authenticates every quiz-sync call — REST (B-32's
 * `quizSyncPublish`/`quizSyncClosePublication`, B-33's
 * `quizSyncCreateSession`/`quizSyncCloseSession`) and this module's WS stream
 * upgrade alike. It lives alongside `quizServerBaseUrl` in the same
 * provisioning file the deploy flow writes, but is deliberately NOT part of
 * the public `DeviceProvisioning` contract type (INV-DP-1 — secrets never
 * appear in `getProvisioning`'s response), so this reads the raw file
 * directly rather than going through `ProvisioningReader`. Read once per
 * connect (WS connects are infrequent), not cached — mirrors
 * `ProvisioningReader`'s "missing/invalid ⇒ null" failure shape without its
 * mtime-cache complexity.
 */
export function readQuizDeviceCredential(provisioningPath: string): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(provisioningPath, 'utf8'));
    const parsed = zQuizCredentialFile.safeParse(raw);
    return parsed.success ? parsed.data.quizDeviceCredential : null;
  } catch {
    return null;
  }
}
