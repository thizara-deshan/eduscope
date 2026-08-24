import { readFileSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const CAMPUS_DIR = resolve(import.meta.dirname, '../../../../deploy/campus');
const UNIT_PATH = join(CAMPUS_DIR, 'eduscope-quiz.service');
const NGINX_TEMPLATE_PATH = join(CAMPUS_DIR, 'nginx-quiz.conf');
const RENDERER_PATH = join(CAMPUS_DIR, 'render-config.mjs');
const ENV_EXAMPLE_PATH = join(CAMPUS_DIR, 'quiz-service.env.example');

/** Parses `key=value`/`key value` lines into a flat map; ignores section headers/comments. */
function parseUnitDirectives(unit: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const rawLine of unit.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[') || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const existing = directives.get(key);
    if (existing) existing.push(value);
    else directives.set(key, [value]);
  }
  return directives;
}

function binaryAvailable(name: string): boolean {
  return spawnSync(name, ['--version'], { shell: false }).error === undefined;
}

describe('deploy/campus/eduscope-quiz.service', () => {
  const unit = readFileSync(UNIT_PATH, 'utf8');
  const directives = parseUnitDirectives(unit);

  it('runs as the dedicated eduscope-quiz user/group, never root', () => {
    expect(directives.get('User')).toEqual(['eduscope-quiz']);
    expect(directives.get('Group')).toEqual(['eduscope-quiz']);
  });

  it('runs migrations before starting the server (ExecStartPre before ExecStart)', () => {
    const pre = directives.get('ExecStartPre')?.[0];
    const start = directives.get('ExecStart')?.[0];
    expect(pre).toContain('db/migrate-cli.js');
    expect(start).toContain('server.js');
    expect(pre).not.toContain('server.js');
  });

  it('never invokes sudo, a shell, or an arbitrary privileged command', () => {
    expect(unit).not.toMatch(/\bsudo\b/);
    expect(unit).not.toMatch(/\/bin\/(ba)?sh\b/);
    for (const command of [...(directives.get('ExecStartPre') ?? []), ...(directives.get('ExecStart') ?? [])]) {
      expect(command.startsWith('/usr/bin/node ')).toBe(true);
    }
  });

  it('never stores or dials a device network address', () => {
    expect(unit).not.toMatch(/device.*address/i);
  });

  it('declares the full systemd sandbox hardening set', () => {
    expect(directives.get('NoNewPrivileges')).toEqual(['true']);
    expect(directives.get('PrivateTmp')).toEqual(['true']);
    expect(directives.get('PrivateDevices')).toEqual(['true']);
    expect(directives.get('ProtectSystem')).toEqual(['strict']);
    expect(directives.get('ProtectHome')).toEqual(['true']);
    expect(directives.get('ProtectKernelTunables')).toEqual(['true']);
    expect(directives.get('ProtectKernelModules')).toEqual(['true']);
    expect(directives.get('ProtectControlGroups')).toEqual(['true']);
    expect(directives.get('RestrictSUIDSGID')).toEqual(['true']);
    expect(directives.get('LockPersonality')).toEqual(['true']);
    expect(directives.get('RestrictAddressFamilies')).toEqual(['AF_UNIX AF_INET AF_INET6']);
    expect(directives.get('SystemCallArchitectures')).toEqual(['native']);
    expect(directives.get('UMask')).toEqual(['0077']);
  });

  it('leaves exactly one writable release path (.next/cache) under a read-only ProtectSystem=strict tree', () => {
    expect(directives.get('ReadWritePaths')).toEqual(['/opt/eduscope/current/apps/quiz/.next/cache']);
  });

  it('deliberately omits MemoryDenyWriteExecute because Node/V8 requires JIT executable memory', () => {
    expect(directives.has('MemoryDenyWriteExecute')).toBe(false);
  });

  it('restarts on failure and reads secrets only from the campus-managed EnvironmentFile', () => {
    expect(directives.get('Restart')).toEqual(['on-failure']);
    expect(directives.get('EnvironmentFile')).toEqual(['/etc/eduscope/quiz-service.env']);
  });

  it('embeds no credential/secret literal in the committed unit', () => {
    expect(unit).not.toMatch(/QUIZ_SERVICE_COOKIE_SECRET=\S+/);
    expect(unit).not.toMatch(/DATABASE_URL=\S+/);
    expect(unit).not.toMatch(/postgres:\/\/[^\s@]+:[^\s@]+@/);
  });

  it('passes systemd-analyze verify when the binary is available on this platform', () => {
    if (!binaryAvailable('systemd-analyze')) {
      // eslint-disable-next-line no-console
      console.warn('systemd-analyze unavailable in this environment — structural checks above remain authoritative');
      return;
    }
    const result = spawnSync('systemd-analyze', ['verify', UNIT_PATH], { shell: false, encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe('deploy/campus/nginx-quiz.conf', () => {
  const template = readFileSync(NGINX_TEMPLATE_PATH, 'utf8');

  it('declares every named render token, with the host token in both the redirect and HTTPS server blocks', () => {
    expect(template.split('@@QUIZ_PUBLIC_HOST@@').length - 1).toBe(2);
    expect(template.split('@@TLS_CERTIFICATE@@').length - 1).toBe(1);
    expect(template.split('@@TLS_CERTIFICATE_KEY@@').length - 1).toBe(1);
  });

  it('redirects plain HTTP to HTTPS', () => {
    expect(template).toMatch(/listen 80;/);
    expect(template).toMatch(/return 308 https:\/\/\$host\$request_uri;/);
  });

  it('sends HSTS and caps the request body at 32 KiB, matching the device/student contract limit', () => {
    expect(template).toMatch(/Strict-Transport-Security/);
    expect(template).toMatch(/client_max_body_size 32k;/);
  });

  it('proxies only to the loopback quiz-service port', () => {
    expect(template).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:7300;/);
    expect(template).not.toMatch(/proxy_pass http:\/\/0\.0\.0\.0/);
  });

  it('forwards the headers a WebSocket upgrade needs', () => {
    expect(template).toMatch(/map \$http_upgrade \$connection_upgrade/);
    expect(template).toMatch(/proxy_set_header Upgrade \$http_upgrade;/);
    expect(template).toMatch(/proxy_set_header Connection \$connection_upgrade;/);
    expect(template).toMatch(/proxy_set_header X-Forwarded-Proto https;/);
    expect(template).toMatch(/proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  });

  it('embeds no filled-in certificate path or secret in the committed template', () => {
    expect(template).not.toMatch(/ssl_certificate \/etc\/[^@]/);
    expect(template).not.toMatch(/\bsudo\b/);
  });
});

describe('deploy/campus/render-config.mjs', () => {
  function runRenderer(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('node', [RENDERER_PATH, ...args], { shell: false, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function tempOutputPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-render-'));
    return join(dir, 'nginx-quiz.rendered.conf');
  }

  it('fails with a named-flag error when a required flag is missing', () => {
    const output = tempOutputPath();
    const result = runRenderer(['--input', NGINX_TEMPLATE_PATH, '--output', output]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing --host/);
  });

  it('rejects an invalid public host', () => {
    const output = tempOutputPath();
    const result = runRenderer([
      '--input', NGINX_TEMPLATE_PATH,
      '--output', output,
      '--host', 'not a hostname!!',
      '--certificate', '/etc/tls/quiz.pem',
      '--certificate-key', '/etc/tls/quiz.key',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid public host/);
  });

  it('rejects a certificate path containing a newline', () => {
    const output = tempOutputPath();
    const result = runRenderer([
      '--input', NGINX_TEMPLATE_PATH,
      '--output', output,
      '--host', 'quiz.example.edu',
      '--certificate', '/etc/tls/quiz.pem\nrogue-directive evil;',
      '--certificate-key', '/etc/tls/quiz.key',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid --certificate/);
  });

  it('fails when the input template does not exist', () => {
    const output = tempOutputPath();
    const result = runRenderer([
      '--input', join(CAMPUS_DIR, 'does-not-exist.conf'),
      '--output', output,
      '--host', 'quiz.example.edu',
      '--certificate', '/etc/tls/quiz.pem',
      '--certificate-key', '/etc/tls/quiz.key',
    ]);
    expect(result.status).not.toBe(0);
  });

  it('renders every token exactly once, leaving no unresolved token behind', async () => {
    const output = tempOutputPath();
    const result = runRenderer([
      '--input', NGINX_TEMPLATE_PATH,
      '--output', output,
      '--host', 'quiz.example.edu',
      '--certificate', '/etc/eduscope/tls/quiz.pem',
      '--certificate-key', '/etc/eduscope/tls/quiz.key',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const rendered = await readFile(output, 'utf8');
    expect(rendered).not.toMatch(/@@[A-Z0-9_]+@@/);
    expect(rendered).toContain('server_name quiz.example.edu;');
    expect(rendered).toContain('ssl_certificate /etc/eduscope/tls/quiz.pem;');
    expect(rendered).toContain('ssl_certificate_key /etc/eduscope/tls/quiz.key;');
  });

  it('rejects a template carrying an unresolved token outside its known replacement set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-render-'));
    const badTemplate = join(dir, 'bad.conf');
    const output = join(dir, 'out.conf');
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        badTemplate,
        'server_name @@QUIZ_PUBLIC_HOST@@;\nssl_certificate @@TLS_CERTIFICATE@@;\nssl_certificate_key @@TLS_CERTIFICATE_KEY@@;\nextra @@UNKNOWN_TOKEN@@;\n',
        'utf8',
      ),
    );
    const result = runRenderer([
      '--input', badTemplate,
      '--output', output,
      '--host', 'quiz.example.edu',
      '--certificate', '/etc/eduscope/tls/quiz.pem',
      '--certificate-key', '/etc/eduscope/tls/quiz.key',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unresolved render token/);
  });

  it('never prints the database URL or a cookie secret (it accepts neither as input)', () => {
    const output = tempOutputPath();
    const result = runRenderer([
      '--input', NGINX_TEMPLATE_PATH,
      '--output', output,
      '--host', 'quiz.example.edu',
      '--certificate', '/etc/eduscope/tls/quiz.pem',
      '--certificate-key', '/etc/eduscope/tls/quiz.key',
    ]);
    expect(result.stdout + result.stderr).not.toMatch(/postgres:\/\//);
    expect(result.stdout + result.stderr).not.toMatch(/cookie.?secret/i);
  });

  it('validates a rendered config with nginx -t when the binary is available', () => {
    if (!binaryAvailable('nginx')) {
      // eslint-disable-next-line no-console
      console.warn('nginx unavailable in this environment — structural checks above remain authoritative');
      return;
    }
    const output = tempOutputPath();
    const rendered = runRenderer([
      '--input', NGINX_TEMPLATE_PATH,
      '--output', output,
      '--host', 'quiz.example.edu',
      '--certificate', '/etc/eduscope/tls/quiz.pem',
      '--certificate-key', '/etc/eduscope/tls/quiz.key',
    ]);
    expect(rendered.status).toBe(0);
    const check = spawnSync('nginx', ['-t', '-c', output], { shell: false, encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  });
});

describe('deploy/campus/quiz-service.env.example', () => {
  const envExample = readFileSync(ENV_EXAMPLE_PATH, 'utf8');

  it('names every variable src/config.ts actually reads, with no value filled in', () => {
    for (const name of [
      'QUIZ_SERVICE_HOST',
      'QUIZ_SERVICE_PORT',
      'QUIZ_SERVICE_DATABASE_URL',
      'QUIZ_SERVICE_PUBLIC_ORIGIN',
      'QUIZ_SERVICE_COOKIE_SECRET',
      'QUIZ_SERVICE_PARTICIPANT_SESSION_TTL_SEC',
      'QUIZ_SERVICE_NEXT_APP_DIR',
      'QUIZ_SERVICE_LOG_LEVEL',
      'DATABASE_URL',
    ]) {
      expect(envExample).toMatch(new RegExp(`^${name}=`, 'm'));
    }
    expect(envExample).not.toMatch(/QUIZ_SERVICE_DATABASE_URL=\S/);
    expect(envExample).not.toMatch(/QUIZ_SERVICE_COOKIE_SECRET=\S/);
    expect(envExample).not.toMatch(/QUIZ_SERVICE_PUBLIC_ORIGIN=\S/);
    expect(envExample).not.toMatch(/^DATABASE_URL=\S/m);
  });

  it('defaults NODE_ENV to production for the campus deployment', () => {
    expect(envExample).toMatch(/^NODE_ENV=production$/m);
  });
});
