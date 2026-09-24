import { readFileSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { CoreDatabase, DrizzleDb } from './client.js';
import { physicalInputs, sourceBindings, users } from './schema.js';
import type { IdGenerator } from '../lib/ids.js';
import { hashPassword } from '../modules/auth/passwords.js';
import type { PmPublisherId, PmPublisherCommandAccepted } from '../modules/recording/pm/types.js';

const input = z.object({ kind: z.enum(['v4l2', 'rtsp', 'alsa']), address: z.string().min(1) }).strict();
const schema = z.object({
  version: z.literal(1),
  wiredInterface: z.string().min(1),
  inputs: z.object({ presentation: input, 'lecturer-cam': input, 'students-cam': input, 'mic-lecturer': input, 'mic-room': input }).strict(),
  bootstrapAdmin: z.object({ username: z.string().min(1), displayName: z.string().min(1), passwordFile: z.string().min(1) }).strict(),
}).strict();

export type DeviceBootstrap = z.infer<typeof schema>;

export function loadDeviceBootstrap(path: string): DeviceBootstrap {
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export async function seedBootstrapAdmin(
  core: CoreDatabase,
  now: Date,
  ids: IdGenerator,
  admin: DeviceBootstrap['bootstrapAdmin'],
  requiredUid = 0,
): Promise<void> {
  if (core.db.select({ id: users.id }).from(users).limit(1).get()) return;
  const fd = openSync(admin.passwordFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  let password: string;
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.uid !== requiredUid || (metadata.mode & 0o137) !== 0) {
      throw new Error('bootstrap admin password must be a regular file with the required owner and mode no broader than 0640');
    }
    password = readFileSync(fd, 'utf8').trimEnd();
  } finally {
    closeSync(fd);
  }
  if (password.length < 12) throw new Error('bootstrap admin password must contain at least 12 characters');
  const passwordHash = await hashPassword(password);
  password = '';
  core.db.insert(users).values({ id: ids.next(now), username: admin.username, displayName: admin.displayName, role: 'admin', source: 'local', externalId: null, passwordHash, mustResetPassword: true, disabled: false, lastLoginAt: null, createdAt: now.toISOString(), createdBy: null, importBatchId: null }).run();
}

const publishers: Record<string, PmPublisherId> = { presentation: 'usb', 'lecturer-cam': 'rtsp', 'students-cam': 'rtsp2', 'mic-lecturer': 'audio', 'mic-room': 'audio' };

export async function pushEnabledBindings(
  db: DrizzleDb,
  pm: {
    setPublisherBinding(id: PmPublisherId, body: { roleId?: string; address: string; credentials?: { username: string; password: string } }): Promise<PmPublisherCommandAccepted>;
    startPublisher(id: PmPublisherId): Promise<PmPublisherCommandAccepted>;
    setProjectorConsumer(body: { mode: 'passthrough' }): Promise<unknown>;
  },
  secrets: { get(ref: string): string | null },
): Promise<void> {
  const bindings = db.select().from(sourceBindings).where(eq(sourceBindings.enabled, true)).all();
  let presentationStarted = false;
  for (const binding of bindings) {
    if (!binding.physicalInputId) continue;
    const publisher = publishers[binding.roleId];
    if (!publisher) continue;
    const physical = db.select().from(physicalInputs).where(eq(physicalInputs.id, binding.physicalInputId)).get();
    if (!physical) continue;
    let credentials: { username: string; password: string } | undefined;
    if (physical.credentialRef) {
      const raw = secrets.get(physical.credentialRef);
      if (raw) {
        const parsed = JSON.parse(raw) as { username?: unknown; password?: unknown };
        if (typeof parsed.username === 'string' && typeof parsed.password === 'string') credentials = { username: parsed.username, password: parsed.password };
      }
    }
    await pm.setPublisherBinding(publisher, { roleId: binding.roleId, address: physical.address, ...(credentials ? { credentials } : {}) });
    await pm.startPublisher(publisher);
    if (binding.roleId === 'presentation') presentationStarted = true;
  }
  // The projector is a managed, persistent room output. Restore its safe
  // default after the presentation publisher is ready so a service restart
  // cannot leave the physical projector displaying an empty desktop.
  if (presentationStarted) await pm.setProjectorConsumer({ mode: 'passthrough' });
}
