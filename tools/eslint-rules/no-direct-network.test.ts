import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: root });

/**
 * `lintText` resolves config by filePath WITHOUT the file needing to exist, so
 * the proof needs no fixture file and no ignore entry that could rot.
 */
const lint = (code: string, filePath: string) =>
  eslint.lintText(code, { filePath: resolve(root, filePath) });

const messagesFor = async (code: string, filePath: string) =>
  (await lint(code, filePath)).flatMap((r) => r.messages);

describe('client-boundary rule (frontend-conventions §1)', () => {
  // The FIRST ESLint#lintText call cold-starts the flat config (parsing
  // eslint.config.js, resolving the TS parser, etc.) — under the root
  // workspace's full parallel test run (25+ files competing for CPU), that
  // cold start alone can exceed vitest's default 5s timeout even though every
  // later call in this file (reusing the same `eslint` instance) takes <50ms.
  it('fails the build on a direct fetch inside a panel component', async () => {
    const messages = await messagesFor(
      `export async function load() { const r = await fetch('/api/v1/recording/state'); return r.json(); }`,
      'apps/panel/src/routes/leaky.ts',
    );
    const errors = messages.filter((m) => m.severity === 2);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((m) => m.ruleId)).toContain('no-restricted-globals');
    expect(errors.map((m) => m.message).join('\n')).toMatch(/EduscopeClient/);
  }, 15_000);

  it.each([
    ['new WebSocket("wss://x")', 'no-restricted-globals'],
    ['new XMLHttpRequest()', 'no-restricted-globals'],
    ['new EventSource("/x")', 'no-restricted-globals'],
    ['window.fetch("/x")', 'no-restricted-properties'],
    ['globalThis.fetch("/x")', 'no-restricted-properties'],
  ])('bans %s', async (expr, ruleId) => {
    const messages = await messagesFor(
      `export const go = () => ${expr};`,
      'apps/panel/src/routes/leaky.ts',
    );
    expect(messages.filter((m) => m.severity === 2).map((m) => m.ruleId)).toContain(ruleId);
  });

  it.each(['axios', 'ky', 'socket.io-client', 'node-fetch'])(
    'bans importing %s',
    async (pkg) => {
      const messages = await messagesFor(
        `import x from '${pkg}';\nexport default x;`,
        'apps/panel/src/routes/leaky.ts',
      );
      expect(messages.filter((m) => m.severity === 2).map((m) => m.ruleId)).toContain(
        'no-restricted-imports',
      );
    },
  );

  it('applies to apps/quiz too — it deploys to the campus web server', async () => {
    const messages = await messagesFor(
      `export const go = () => fetch('/api/join');`,
      'apps/quiz/app/j/[joinCode]/page.tsx',
    );
    expect(messages.filter((m) => m.severity === 2).length).toBeGreaterThan(0);
  });

  it('ALLOWS the same code inside packages/api-client — it IS the boundary', async () => {
    const messages = await messagesFor(
      `export const go = () => fetch('/api/v1/recording/state');`,
      'packages/api-client/src/real/transport.ts',
    );
    const banned = messages.filter(
      (m) =>
        m.severity === 2 &&
        ['no-restricted-globals', 'no-restricted-imports', 'no-restricted-properties'].includes(
          m.ruleId ?? '',
        ),
    );
    expect(banned, 'the boundary itself must not be gagged').toEqual([]);
  });
});
