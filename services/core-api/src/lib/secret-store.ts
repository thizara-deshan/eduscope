import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Clock } from './clock.js';
import type { IdGenerator } from './ids.js';

// `libsodium-wrappers`'s ESM build (`dist/modules-esm/libsodium-wrappers.mjs`)
// imports a sibling `./libsodium.mjs` that the package never ships — a known
// upstream packaging gap. Its CJS build does not have this problem (it
// `require`s the `libsodium` package by name), so this loads that build
// through `createRequire` instead of a native ESM import.
const sodium: typeof import('libsodium-wrappers') = createRequire(import.meta.url)('libsodium-wrappers');

export interface SecretStoreDeps {
  dir: string;
  key: string;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * PF-17 file-backed secret store (design/core-api.md §3.2): `credentialRef`/
 * `streamKeyRef` resolve here, never in SQLite, a response, an event, a log
 * line, or an audit `before`/`after` (INV-ST-1, INV-AU-3, INV-UJ-5). One
 * libsodium secretbox-sealed file per secret under `dir` (mode 0600); the box
 * key is derived from the provisioned `secretboxKey` string via
 * `crypto_generichash` so any UTF-8 device key of any length works as
 * `crypto_secretbox`'s fixed-length key material.
 */
export class SecretStore {
  readonly #dir: string;
  readonly #boxKey: Uint8Array;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  private constructor(dir: string, boxKey: Uint8Array, ids: IdGenerator, clock: Clock) {
    this.#dir = dir;
    this.#boxKey = boxKey;
    this.#ids = ids;
    this.#clock = clock;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  static async create(deps: SecretStoreDeps): Promise<SecretStore> {
    await sodium.ready;
    const boxKey = sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, sodium.from_string(deps.key));
    return new SecretStore(deps.dir, boxKey, deps.ids, deps.clock);
  }

  /** Encrypts `plaintext` and returns a new opaque ref — the only thing ever persisted alongside the secret elsewhere. */
  put(plaintext: string): string {
    const ref = this.#ids.next(this.#clock.now());
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, this.#boxKey);
    writeFileSync(this.#path(ref), Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]), { mode: 0o600 });
    return ref;
  }

  /** Decrypts the secret behind `ref`, or `null` if it does not (or no longer) exist. */
  get(ref: string): string | null {
    const path = this.#path(ref);
    if (!existsSync(path)) return null;
    const blob = readFileSync(path);
    const nonce = blob.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = blob.subarray(sodium.crypto_secretbox_NONCEBYTES);
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, this.#boxKey);
    return sodium.to_string(plaintext);
  }

  delete(ref: string): void {
    const path = this.#path(ref);
    if (existsSync(path)) rmSync(path);
  }

  #path(ref: string): string {
    return join(this.#dir, `${ref}.secret`);
  }
}
