import type { UsbVolume } from '@eduscope/shared';

export interface FakeBlockDevice extends UsbVolume {
  usage: 'removable' | 'system' | 'recordings';
}

export class FakeBlockDeviceMonitor {
  #volumes: FakeBlockDevice[];
  readonly #listeners = new Set<(volumes: readonly FakeBlockDevice[]) => void>();

  constructor(volumes: readonly FakeBlockDevice[] = []) {
    this.#volumes = [...volumes];
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  snapshot(): readonly FakeBlockDevice[] { return this.#volumes.map((volume) => ({ ...volume })); }
  async refresh(): Promise<readonly FakeBlockDevice[]> { return this.snapshot(); }
  subscribe(listener: (volumes: readonly FakeBlockDevice[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  setVolumes(volumes: readonly FakeBlockDevice[]): void {
    this.#volumes = [...volumes];
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
