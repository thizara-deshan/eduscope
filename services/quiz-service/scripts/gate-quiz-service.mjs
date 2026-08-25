import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const steps = [
  ['--filter', '@eduscope/shared', 'test'],
  ['--filter', '@eduscope/quiz-service', 'typecheck'],
  ['--filter', '@eduscope/quiz-service', 'test'],
  ['--filter', '@eduscope/core-api', 'test', '--', 'test/quiz', 'test/contract/sync-hello.contract.test.ts'],
  ['--filter', '@eduscope/api-client', 'test'],
  ['--filter', '@eduscope/quiz', 'test'],
];

for (const args of steps) {
  const result = spawnSync(pnpm, args, {
    cwd: new URL('../../..', import.meta.url),
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
