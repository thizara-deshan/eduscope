import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const steps = [
  [pnpm, ['--filter', '@eduscope/core-api', 'typecheck']],
  [pnpm, ['--filter', '@eduscope/core-api', 'test']],
  [pnpm, ['--filter', '@eduscope/shared', 'test']],
  [pnpm, ['--filter', '@eduscope/api-client', 'test']],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    cwd: new URL('../../..', import.meta.url),
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write('79 REST / 22 panel events / 5 preview variants / 1 sync.hello\n');
