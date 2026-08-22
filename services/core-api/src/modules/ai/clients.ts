/**
 * Typed HTTP/SSE wrappers for the three device-local AI services
 * (docs/design/ai-services.md §0): stt-service (127.0.0.1:7101), slide-service
 * (127.0.0.1:7102), question-service (127.0.0.1:7103). Same shape as the
 * pipeline-manager boundary (B-04) — Node `fetch` only, no generic HTTP client
 * abstraction, credentials never appear in a thrown error. core-api is the
 * only client (ai-services.md "Ownership rule") — these services persist
 * nothing themselves.
 */

export interface AiServiceProblem {
  code: string;
  title: string;
  status: number;
}

export class AiServiceError extends Error {
  readonly problem: AiServiceProblem;

  constructor(problem: AiServiceProblem) {
    super(`${problem.code}: ${problem.title}`);
    this.name = 'AiServiceError';
    this.problem = problem;
  }
}

const DEFAULT_PROBLEM: AiServiceProblem = { code: 'internal', title: 'AI service request failed', status: 502 };

export interface AiSseFrame {
  id: number | null;
  event: string;
  data: unknown;
}

function parseFrame(raw: string): AiSseFrame | null {
  let id: number | null = null;
  let event = 'message';
  const dataLines: string[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('id:')) {
      id = Number(line.slice('id:'.length).trim());
    } else if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  if (dataLines.length === 0 && event === 'message') {
    return null; // a blank/comment-only frame — nothing to dispatch
  }

  const dataText = dataLines.join('\n');
  let data: unknown = {};
  if (dataText.length > 0) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }

  return { id, event, data };
}

/** Line-buffered parser for the `text/event-stream` bodies these services share (ai-services.md §0: "identical to pipeline-manager §3"). */
export async function* parseAiSseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<AiSseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(rawEvent);
        if (frame) yield frame;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface HttpClientDeps {
  baseUrl: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
}

abstract class BaseAiClient {
  protected readonly baseUrl: string;
  protected readonly bearerToken: string;
  protected readonly fetchImpl: typeof fetch;

  constructor(deps: HttpClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/$/, '');
    this.bearerToken = deps.bearerToken;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  protected async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.bearerToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
    };
    if (signal !== undefined) init.signal = signal;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new AiServiceError(await this.toProblem(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private async toProblem(response: Response): Promise<AiServiceProblem> {
    try {
      const body = (await response.json()) as Partial<AiServiceProblem>;
      return { code: body.code ?? DEFAULT_PROBLEM.code, title: body.title ?? DEFAULT_PROBLEM.title, status: response.status };
    } catch {
      return { ...DEFAULT_PROBLEM, status: response.status };
    }
  }

  /** Opens the raw `GET /events` SSE response for a caller to line-parse with `parseAiSseStream`. */
  async openEventStream(signal: AbortSignal): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}/events`, { headers: { authorization: `Bearer ${this.bearerToken}` }, signal });
    if (!response.ok || !response.body) {
      throw new AiServiceError(await this.toProblem(response));
    }
    return response;
  }
}

export interface SttStatus {
  state: 'idle' | 'listening' | 'paused' | 'degraded';
  sessionId: string | null;
  model: string | null;
  modelVersion: string | null;
  samplesConsumed: number | null;
  lastSegmentAt: string | null;
  audioSource: { attached: boolean; fps: number | null } | null;
}

/** ai-services.md §1.4 — the only client for stt-service. */
export class SttClient extends BaseAiClient {
  async startSession(sessionId: string, anchorOffsetMs: number): Promise<void> {
    await this.request('POST', '/sessions', { sessionId, anchorOffsetMs });
  }

  async pauseSession(sessionId: string): Promise<void> {
    await this.request('POST', `/sessions/${sessionId}/pause`, {});
  }

  /** §1.3 — rebases the sample clock so post-pause offsets stay aligned with the recording timeline. */
  async resumeSession(sessionId: string, anchorOffsetMs: number): Promise<void> {
    await this.request('POST', `/sessions/${sessionId}/resume`, { anchorOffsetMs });
  }

  async endSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/sessions/${sessionId}`);
  }

  async getStatus(): Promise<SttStatus> {
    return this.request<SttStatus>('GET', '/status');
  }
}

export interface SlideStatus {
  state: 'idle' | 'watching';
  sessionId: string | null;
  slideCount: number;
  lastCaptureAt: string | null;
  ocrBacklog: number;
}

/** ai-services.md §2.3 — the only client for slide-service. */
export class SlideClient extends BaseAiClient {
  /**
   * `sourcePath` = pipeline-manager's snapshot-consumer output (tmpfs);
   * `imageDir` = the durable slide home under the recordings volume (§2.2).
   * `anchorOffsetMs` (C execution gate item 4, ratified: symmetric with
   * `SttClient.startSession`, a duration in ms — not `sessionStartedAt`) lets
   * slide-service compute session-relative `offsetMs` the same way STT does.
   */
  async startSession(sessionId: string, imageDir: string, sourcePath: string, anchorOffsetMs: number): Promise<void> {
    await this.request('POST', '/sessions', { sessionId, imageDir, sourcePath, anchorOffsetMs });
  }

  /**
   * C execution gate item 4 — mirrors `SttClient.resumeSession`. The slide
   * session itself is never torn down across a pause (pipeline-manager's
   * snapshot-consumer stop *is* the pause, ai-services.md §2.3), but its
   * offset clock still needs rebasing on resume or a paused gap would inflate
   * every later `offsetMs` by the pause duration.
   */
  async resumeSession(sessionId: string, anchorOffsetMs: number): Promise<void> {
    await this.request('POST', `/sessions/${sessionId}/resume`, { anchorOffsetMs });
  }

  async endSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/sessions/${sessionId}`);
  }

  async getStatus(): Promise<SlideStatus> {
    return this.request<SlideStatus>('GET', '/status');
  }
}

export interface QuestionProbeResult {
  reachable: boolean;
  latencyMs: number | null;
  model?: string;
}

export interface QuestionGenerateRequest {
  sessionId: string;
  questionSetId: string;
  count: { min: number; max: number };
  transcript: { fromOffsetMs: number; toOffsetMs: number; text: string };
  slides: Array<{ offsetMs: number; ocrText: string }>;
  promptVersion?: string;
  llmEndpoint: string;
}

export interface QuestionGenerateResponse {
  questionSetId: string;
  promptVersion: string;
  modelId: string | null;
  requested: number;
  returned: number;
  droppedInvalid: number;
  questions: Array<{ prompt: string; options: Array<{ text: string; isCorrect: boolean }> }>;
}

/**
 * ai-services.md §3.4 — the only client for question-service. `generate` is
 * the typed wrapper machine 2b (B-30) will call; the retry/timeout policy
 * around it belongs to that machine, not to this HTTP boundary.
 */
export class QuestionClient extends BaseAiClient {
  /** §3.6 recovery loop (Q-06) — `llmEndpoint` is passed per call since the service holds no config state of its own (INV-DP-3). */
  async probe(llmEndpoint: string): Promise<QuestionProbeResult> {
    return this.request<QuestionProbeResult>('GET', `/probe?llmEndpoint=${encodeURIComponent(llmEndpoint)}`);
  }

  async generate(body: QuestionGenerateRequest, signal?: AbortSignal): Promise<QuestionGenerateResponse> {
    return this.request<QuestionGenerateResponse>('POST', '/generate', body, signal);
  }
}
