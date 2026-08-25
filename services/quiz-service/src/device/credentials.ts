import argon2 from 'argon2';

const MIN_TOKEN_LENGTH = 32;

/** Argon2id hash of a deploy-provisioned static device bearer. Raw tokens never persist. */
export async function hashDeviceCredential(token: string): Promise<string> {
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`device credential must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return argon2.hash(token, { type: argon2.argon2id });
}

export async function verifyDeviceCredential(hash: string, token: string): Promise<boolean> {
  return argon2.verify(hash, token);
}
