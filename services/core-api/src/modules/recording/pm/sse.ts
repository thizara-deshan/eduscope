import type { PmSseFrame } from './types.js';

function parseFrame(raw: string): PmSseFrame | null {
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

/**
 * Line-buffered parser for pipeline-manager's `text/event-stream` body
 * (matches `api/events.py`'s `format_sse`: `id: N\nevent: kind\ndata: json\n\n`).
 * No generic SSE library — the wire format is small and fixed (B-04 plan Step 3).
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<PmSseFrame> {
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
