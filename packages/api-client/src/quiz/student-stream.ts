import {
  zStudentEventEnvelope,
  type StudentEventEnvelope,
  type StudentServerEvent,
} from '@eduscope/shared';
import { TransportError } from '../errors.js';
import { createEmitter, type EventStream } from '../stream.js';

export interface StudentWebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  close(code?: number, reason?: string): void;
}

/** Cookie authentication is implicit in the browser; no protocols argument is allowed. */
export type StudentWebSocketFactory = (url: string) => StudentWebSocketLike;

export interface StudentStream {
  readonly events$: EventStream<StudentServerEvent>;
  connect(): Promise<readonly StudentServerEvent[]>;
  dispose(): void;
}

interface ActiveConnection {
  readonly socket: StudentWebSocketLike;
  superseded: boolean;
}

export function studentWsUrl(baseUrl: string): string {
  const http = `${baseUrl.replace(/\/+$/, '')}/api/student/v1/stream`;
  if (http.startsWith('https:')) return `wss:${http.slice('https:'.length)}`;
  if (http.startsWith('http:')) return `ws:${http.slice('http:'.length)}`;
  if (http.startsWith('//')) return `wss:${http}`;
  if (http.startsWith('/')) {
    const origin = globalThis.location?.origin ?? '';
    return `${origin.replace(/^http/, 'ws')}${http}`;
  }
  return http;
}

export function createStudentStream(options: {
  baseUrl: string;
  webSocket: StudentWebSocketFactory;
}): StudentStream {
  const events = createEmitter<StudentServerEvent>();
  let active: ActiveConnection | null = null;
  let disposed = false;

  const replaceActive = () => {
    if (!active) return;
    active.superseded = true;
    active.socket.onopen = null;
    active.socket.onmessage = null;
    active.socket.onclose = null;
    active.socket.onerror = null;
    active.socket.close(1000, 'reconnect');
    active = null;
  };

  return {
    events$: events,

    connect() {
      if (disposed) return Promise.reject(new TransportError('connect'));
      replaceActive();

      return new Promise<readonly StudentServerEvent[]>((resolve, reject) => {
        const socket = options.webSocket(studentWsUrl(options.baseUrl));
        const connection: ActiveConnection = { socket, superseded: false };
        active = connection;
        const snapshot: StudentServerEvent[] = [];
        const pendingLive: StudentServerEvent[] = [];
        let lastSeq: number | null = null;
        let snapshotResolved = false;
        let live = false;
        let failed = false;

        const fail = (cause?: unknown) => {
          if (failed || connection.superseded || disposed) return;
          failed = true;
          reject(new TransportError('connect', cause === undefined ? undefined : { cause }));
          socket.close(1008, 'invalid student stream');
        };

        const finishSnapshot = () => {
          if (snapshotResolved) return;
          snapshotResolved = true;
          resolve([...snapshot]);
          queueMicrotask(() => {
            if (failed || connection.superseded || disposed) return;
            live = true;
            for (const event of pendingLive.splice(0)) events.emit(event);
          });
        };

        socket.onmessage = ({ data }) => {
          let envelope: StudentEventEnvelope;
          try {
            envelope = zStudentEventEnvelope.parse(JSON.parse(data)) as StudentEventEnvelope;
          } catch (error) {
            fail(error);
            return;
          }

          if (lastSeq !== null && envelope.seq !== lastSeq + 1) {
            fail(new Error('student stream sequence gap'));
            return;
          }
          lastSeq = envelope.seq;
          const { at: _at, seq: _seq, ...event } = envelope;
          const stripped = event as StudentServerEvent;

          if (snapshotResolved) {
            if (live) events.emit(stripped);
            else pendingLive.push(stripped);
            return;
          }

          const index = snapshot.length;
          const expected = index === 0
            ? 'quiz.session'
            : index === 1
              ? 'quiz.participant'
              : index === 2
                ? 'quiz.question'
                : 'quiz.result';
          if (stripped.event !== expected) {
            fail(new Error(`student snapshot expected ${expected}, got ${stripped.event}`));
            return;
          }
          snapshot.push(stripped);
          if (index === 2 && stripped.event === 'quiz.question') {
            if (stripped.payload.state !== 'closed') finishSnapshot();
          } else if (index === 3) {
            finishSnapshot();
          }
        };

        socket.onerror = () => fail(new Error('student socket error'));
        socket.onclose = () => {
          if (connection.superseded || disposed || failed) return;
          if (!snapshotResolved) {
            fail(new Error('student socket closed during snapshot'));
            return;
          }
          events.emit({ event: 'quiz.participant', payload: { connectionState: 'offline' } });
        };
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      replaceActive();
    },
  };
}
