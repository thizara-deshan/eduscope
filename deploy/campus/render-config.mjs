import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function flags(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('flags must be --name value pairs');
    result.set(key.slice(2), value);
  }
  return result;
}

const args = flags(process.argv.slice(2));
const required = ['input', 'output', 'host', 'certificate', 'certificate-key'];
for (const name of required) if (!args.get(name)) throw new Error(`missing --${name}`);
const host = args.get('host');
if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) {
  throw new Error('invalid public host');
}
for (const name of ['certificate', 'certificate-key']) {
  if (/[\r\n\0]/.test(args.get(name))) throw new Error(`invalid --${name}`);
}

let rendered = await readFile(resolve(args.get('input')), 'utf8');
const replacements = new Map([
  ['@@QUIZ_PUBLIC_HOST@@', host],
  ['@@TLS_CERTIFICATE@@', args.get('certificate')],
  ['@@TLS_CERTIFICATE_KEY@@', args.get('certificate-key')],
]);
for (const [token, value] of replacements) {
  const occurrences = rendered.split(token).length - 1;
  if (occurrences === 0) throw new Error(`expected at least one ${token}`);
  rendered = rendered.split(token).join(value);
}
if (/@@[A-Z0-9_]+@@/.test(rendered)) throw new Error('unresolved render token');

const output = resolve(args.get('output'));
await mkdir(dirname(output), { recursive: true });
const temporary = `${output}.${randomUUID()}.tmp`;
await writeFile(temporary, rendered, { mode: 0o644, flag: 'wx' });
await rename(temporary, output);
