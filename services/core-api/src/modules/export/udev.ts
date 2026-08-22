import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, normalize, parse, relative, resolve } from 'node:path';
import type { UsbVolume } from '@eduscope/shared';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';

export interface BlockDeviceCandidate extends UsbVolume {
  /** Test/projection hint; production derives this from mountpoints. */
  usage?: 'removable' | 'system' | 'recordings';
}

export interface BlockDeviceArgv {
  lsblk(): Promise<string>;
  watch(onChange: () => void, onError: (error: Error) => void): { stop(): void };
}

export interface BlockDeviceMonitorLike extends LifecycleComponent {
  snapshot(): readonly BlockDeviceCandidate[];
  refresh(): Promise<readonly BlockDeviceCandidate[]>;
  subscribe(listener: (volumes: readonly BlockDeviceCandidate[]) => void): () => void;
}

interface LsblkDevice {
  path?: unknown;
  label?: unknown;
  size?: unknown;
  fsavail?: unknown;
  mountpoint?: unknown;
  mountpoints?: unknown;
  children?: unknown;
}

class SystemBlockDeviceArgv implements BlockDeviceArgv {
  lsblk(): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      execFile(
        'lsblk',
        ['--json', '--bytes', '--output', 'PATH,LABEL,SIZE,FSAVAIL,MOUNTPOINT,MOUNTPOINTS'],
        { shell: false, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`lsblk failed: ${stderr.trim() || error.message}`));
          else resolveOutput(stdout);
        },
      );
    });
  }

  watch(onChange: () => void, onError: (error: Error) => void): { stop(): void } {
    const child: ChildProcess = spawn(
      'udevadm',
      ['monitor', '--subsystem-match=block', '--property'],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout?.on('data', onChange);
    child.once('error', onError);
    return { stop: () => child.kill() };
  }
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function flatten(nodes: unknown): LsblkDevice[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) => {
    if (!node || typeof node !== 'object') return [];
    const device = node as LsblkDevice;
    return [device, ...flatten(device.children)];
  });
}

function pathContains(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  const pathFromParent = relative(normalizedParent, normalizedChild);
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

function sameSnapshot(left: readonly BlockDeviceCandidate[], right: readonly BlockDeviceCandidate[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseLsblkSnapshot(output: string, recordingsRoot: string): BlockDeviceCandidate[] {
  const parsed = JSON.parse(output) as { blockdevices?: unknown };
  const candidates: BlockDeviceCandidate[] = [];
  for (const device of flatten(parsed.blockdevices)) {
    if (typeof device.path !== 'string') continue;
    const mountPath = strings(device.mountpoint ?? device.mountpoints).find((item) => item.length > 0);
    const capacityBytes = numberValue(device.size);
    const freeBytes = numberValue(device.fsavail);
    if (!mountPath || !isAbsolute(mountPath) || capacityBytes === null || freeBytes === null) continue;
    const normalizedMount = normalize(mountPath);
    const systemRoot = parse(normalizedMount).root;
    const usage = normalizedMount === systemRoot
      ? 'system'
      : pathContains(normalizedMount, recordingsRoot)
        ? 'recordings'
        : 'removable';
    candidates.push({
      devicePath: device.path,
      mountPath: normalizedMount,
      label: typeof device.label === 'string' ? device.label : null,
      capacityBytes,
      freeBytes,
      usage,
    });
  }
  return candidates;
}

export function publicUsbVolumes(volumes: readonly BlockDeviceCandidate[]): UsbVolume[] {
  return volumes
    .filter((volume) => volume.usage !== 'system' && volume.usage !== 'recordings')
    .map(({ devicePath, mountPath, label, capacityBytes, freeBytes }) => ({ devicePath, mountPath, label, capacityBytes, freeBytes }));
}

export class BlockDeviceMonitor implements BlockDeviceMonitorLike {
  readonly name = 'usb-block-device-monitor';
  readonly #argv: BlockDeviceArgv;
  readonly #recordingsRoot: string;
  readonly #enabled: boolean;
  readonly #logger: { warn(message: string, meta?: Record<string, unknown>): void };
  readonly #listeners = new Set<(volumes: readonly BlockDeviceCandidate[]) => void>();
  #volumes: BlockDeviceCandidate[] = [];
  #watcher: { stop(): void } | null = null;
  #refreshing: Promise<readonly BlockDeviceCandidate[]> | null = null;

  constructor(options: { recordingsRoot: string; enabled?: boolean; argv?: BlockDeviceArgv; logger?: { warn(message: string, meta?: Record<string, unknown>): void } }) {
    this.#recordingsRoot = options.recordingsRoot;
    this.#enabled = options.enabled ?? true;
    this.#argv = options.argv ?? new SystemBlockDeviceArgv();
    this.#logger = options.logger ?? { warn: () => undefined };
  }

  async start(): Promise<void> {
    if (!this.#enabled) return;
    try { await this.refresh(); } catch (error) { this.#logger.warn('Initial USB snapshot failed', { error: String(error) }); }
    if (process.platform === 'win32') return;
    this.#watcher = this.#argv.watch(
      () => { void this.refresh().catch((error) => this.#logger.warn('USB snapshot refresh failed', { error: String(error) })); },
      (error) => this.#logger.warn('udevadm monitor failed', { error: error.message }),
    );
  }

  async stop(_reason?: LifecycleStopReason): Promise<void> {
    this.#watcher?.stop();
    this.#watcher = null;
  }

  snapshot(): readonly BlockDeviceCandidate[] { return this.#volumes.map((volume) => ({ ...volume })); }

  refresh(): Promise<readonly BlockDeviceCandidate[]> {
    if (!this.#enabled) return Promise.resolve(this.snapshot());
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#argv.lsblk().then((output) => {
      const next = parseLsblkSnapshot(output, this.#recordingsRoot);
      const changed = !sameSnapshot(this.#volumes, next);
      this.#volumes = next;
      const snapshot = this.snapshot();
      if (changed) for (const listener of this.#listeners) listener(snapshot);
      return snapshot;
    }).finally(() => { this.#refreshing = null; });
    return this.#refreshing;
  }

  subscribe(listener: (volumes: readonly BlockDeviceCandidate[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
