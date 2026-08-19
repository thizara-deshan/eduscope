import {
  PipelineManagerError,
  type EffectiveEncodeProfile,
  type PmAudioControlResult,
  type PmCommandAccepted,
  type PmPublisherCommandAccepted,
  type PmPublisherId,
  type PmProblem,
  type PmSourcesStatus,
  type PmStatus,
} from './types.js';

export interface PipelineManagerClientDeps {
  baseUrl: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
}

/** KEEP B-56 gate correction (2026-08-18, resolved) — the five fields mirror `EffectiveEncodeProfile`, all optional; PM applies whichever are present to the composite/re-encode profile and ignores them for passthrough. */
export interface EncodeProfileOverrideFields {
  videoBitrateBps?: number;
  fps?: number;
  gop?: number;
  rateControl?: 'cbr' | 'vbr';
  audioBitrateBps?: number;
}

export interface StartRecordConsumerBody extends EncodeProfileOverrideFields {
  preset: string;
  ratioA?: number;
  ratioB?: number;
  outputPath?: string;
  outputPaths?: Record<string, string>;
}

/** Machine 1c streaming (CH-02): pipeline-manager.md §3.2 `POST /consumers/live`. */
export interface StartLiveConsumerBody extends EncodeProfileOverrideFields {
  preset: string;
  ratioA?: number;
  ratioB?: number;
  streamKey: string;
}

/** Machine 1c meeting (CH-04): pipeline-manager.md §3.2 `POST /consumers/meeting`. */
export interface StartMeetingConsumerBody {
  preset: string;
  ratioA?: number;
  ratioB?: number;
}

/** HL-09 (`cmd.admin.set_binding`): pipeline-manager.md §3.2 `PUT /publishers/{id}/binding` — credentials arrive separate from the address, never interpolated into it. */
export interface SetPublisherBindingBody {
  address: string;
  credentials?: { username: string; password: string };
  devicePath?: string;
}

const DEFAULT_PROBLEM: PmProblem = { code: 'internal', title: 'pipeline-manager request failed', status: 502 };

/** Spreads an `EffectiveEncodeProfile` onto a record/live start body — never called for passthrough call sites. */
export function toEncodeProfileOverride(profile: EffectiveEncodeProfile): EncodeProfileOverrideFields {
  return {
    videoBitrateBps: profile.videoBitrateBps,
    fps: profile.fps,
    gop: profile.gop,
    rateControl: profile.rateControl,
    audioBitrateBps: profile.audioBitrateBps,
  };
}

/**
 * Typed HTTP wrapper for pipeline-manager's internal API
 * (docs/design/pipeline-manager.md §3.2) — Node `fetch` only, no generic
 * client abstraction beyond this boundary (B-04 plan Step 3). Credentials
 * (the shared bearer) never appear in a thrown error or a log line — only
 * route/status/redacted ids do (see `sse.ts`/`dispatcher.ts`).
 */
export class PipelineManagerClient {
  readonly #baseUrl: string;
  readonly #bearerToken: string;
  readonly #fetch: typeof fetch;

  constructor(deps: PipelineManagerClientDeps) {
    this.#baseUrl = deps.baseUrl.replace(/\/$/, '');
    this.#bearerToken = deps.bearerToken;
    this.#fetch = deps.fetchImpl ?? fetch;
  }

  async getStatus(signal?: AbortSignal): Promise<PmStatus> {
    return this.#request<PmStatus>('GET', '/status', undefined, signal);
  }

  async getSources(signal?: AbortSignal): Promise<PmSourcesStatus> {
    return this.#request<PmSourcesStatus>('GET', '/sources', undefined, signal);
  }

  async startRecordConsumer(body: StartRecordConsumerBody): Promise<PmCommandAccepted> {
    return this.#request<PmCommandAccepted>('POST', '/consumers/record', body);
  }

  /** CH-02 (preflight already passed): pipeline-manager.md §3.2 `POST /consumers/live`. */
  async startLiveConsumer(body: StartLiveConsumerBody): Promise<PmCommandAccepted> {
    return this.#request<PmCommandAccepted>('POST', '/consumers/live', body);
  }

  /** CH-04: pipeline-manager.md §3.2 `POST /consumers/meeting`. */
  async startMeetingConsumer(body: StartMeetingConsumerBody): Promise<PmCommandAccepted> {
    return this.#request<PmCommandAccepted>('POST', '/consumers/meeting', body);
  }

  async setLed(mode: 'blink' | 'off'): Promise<void> {
    await this.#request('POST', '/device/led', { mode });
  }

  /** HL-09: the one place a source address/credential reaches A (INV-PI-2, B-46). `id ∈ {usb, rtsp, rtsp2, audio}`. */
  async setPublisherBinding(publisherId: PmPublisherId, body: SetPublisherBindingBody): Promise<PmPublisherCommandAccepted> {
    return this.#request<PmPublisherCommandAccepted>('PUT', `/publishers/${publisherId}/binding`, body);
  }

  /** `mic-lecturer` only in V1 (INV-AC-1) — the readback is the truth; a mixer failure is `appliedState:'failed'` in a `200`, not a thrown Problem. */
  async setAudioControl(gain: number, muted: boolean): Promise<PmAudioControlResult> {
    return this.#request<PmAudioControlResult>('PUT', '/audio/controls/mic-lecturer', { gain, muted });
  }

  /** R-08/R-11 (pipeline-manager.md §3.2): default `eos` — the manager itself waits up to `timeoutMs` then escalates to SIGKILL; core-api only stops waiting for `evt.pm.consumer.eos` after its own local timer (recovery.ts). */
  async stopConsumer(consumerId: string, body: { mode: 'eos' | 'kill'; timeoutMs?: number }): Promise<void> {
    await this.#request('POST', `/consumers/${consumerId}/stop`, body);
  }

  /**
   * Opens the raw `GET /events` SSE response for `sse.ts` to line-parse.
   * `lastEventId` maps to the `Last-Event-ID` request header pipeline-manager
   * uses for replay (pipeline-manager.md §3.1).
   */
  async openEventStream(lastEventId: number | null, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#bearerToken}` };
    if (lastEventId !== null) {
      headers['last-event-id'] = String(lastEventId);
    }
    const response = await this.#fetch(`${this.#baseUrl}/events`, { headers, signal });
    if (!response.ok || !response.body) {
      throw new PipelineManagerError(await this.#toProblem(response));
    }
    return response;
  }

  async #request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.#bearerToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
    };
    if (signal !== undefined) init.signal = signal;
    const response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    if (!response.ok) {
      throw new PipelineManagerError(await this.#toProblem(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async #toProblem(response: Response): Promise<PmProblem> {
    try {
      const body = (await response.json()) as Partial<PmProblem>;
      return {
        code: body.code ?? DEFAULT_PROBLEM.code,
        title: body.title ?? DEFAULT_PROBLEM.title,
        status: response.status,
        ...(body.meta !== undefined ? { meta: body.meta } : {}),
      };
    } catch {
      return { ...DEFAULT_PROBLEM, status: response.status };
    }
  }
}
