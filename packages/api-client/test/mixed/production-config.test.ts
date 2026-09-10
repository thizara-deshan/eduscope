import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANEL_EVENT_NAMES, PANEL_OPERATION_IDS, SERVER_SIDE_ONLY_OPERATION_IDS } from '@eduscope/shared';
import { ADAPTER_DOMAINS } from '../../src/mixed/domains.js';
import { zRuntimeConfig } from '../../src/mixed/runtime-config.js';

const REPO = resolve(__dirname, '../../../..');
const TEMPLATE_PATH = resolve(REPO, 'deploy/runtime/config.production.json.template');
const OPENAPI = readFileSync(resolve(REPO, 'contracts/openapi.yaml'), 'utf8');
const QUIZ_APP = readFileSync(resolve(REPO, 'contracts/quiz-app.yaml'), 'utf8');
const EVENTS = readFileSync(resolve(REPO, 'contracts/events.md'), 'utf8');

const operationIds = (spec: string): string[] => [...spec.matchAll(/^\s+operationId:\s*(\w+)\s*$/gm)].map((m) => m[1]!);

/** The production runtime config after deploy token substitution. */
function substitutedTemplate(): unknown {
  const raw = readFileSync(TEMPLATE_PATH, 'utf8').replace('@QUIZ_PUBLIC_ORIGIN@', 'https://quiz.campus.example.edu');
  return JSON.parse(raw);
}

describe('E-50 production runtime config', () => {
  it('the committed template is exactly {default:"real",overrides:{}} in production', () => {
    const parsed = substitutedTemplate();
    expect(parsed).toEqual({
      apiBaseUrl: '/api/v1',
      quizBaseUrl: 'https://quiz.campus.example.edu',
      environment: 'production',
      deploymentProfile: 'production',
      notices: [],
      adapters: { default: 'real', overrides: {} },
    });
    expect(zRuntimeConfig.parse(parsed).adapters).toEqual({ default: 'real', overrides: {} });
  });

  it('rejects demo staging without the acceptance notice', () => {
    expect(zRuntimeConfig.safeParse({apiBaseUrl:'/api/v1',quizBaseUrl:'https://quiz.campus.example.edu',environment:'production',deploymentProfile:'demo-staging',notices:[],adapters:{default:'real',overrides:{}}}).success).toBe(false);
  });

  it('the template placeholder is unresolved until deploy substitution', () => {
    const raw = readFileSync(TEMPLATE_PATH, 'utf8');
    expect(raw).toContain('@QUIZ_PUBLIC_ORIGIN@');
  });

  it('rejects every production override, one domain at a time', () => {
    for (const domain of ADAPTER_DOMAINS) {
      const config = {
        apiBaseUrl: '/api/v1',
        quizBaseUrl: 'https://quiz.campus.example.edu',
        environment: 'production',
        adapters: { default: 'real', overrides: { [domain]: 'mock' } },
      };
      const result = zRuntimeConfig.safeParse(config);
      expect(result.success, `production override for ${domain} must be rejected`).toBe(false);
    }
  });

  it('accepts a mock override only outside production', () => {
    const dev = zRuntimeConfig.safeParse({
      apiBaseUrl: '/api/v1',
      quizBaseUrl: 'https://quiz.campus.example.edu',
      environment: 'development',
      adapters: { default: 'real', overrides: { preview: 'mock' } },
    });
    expect(dev.success).toBe(true);
  });

  it('covers all nineteen domains by the default when overrides are empty', () => {
    expect(ADAPTER_DOMAINS).toHaveLength(19);
    // With no overrides every domain resolves to the single `default` — so a
    // production `{default:'real',overrides:{}}` selects real for all nineteen.
    const parsed = zRuntimeConfig.parse(substitutedTemplate());
    expect(Object.keys(parsed.adapters.overrides)).toHaveLength(0);
  });
});

describe('E-50 contract ownership and count audit', () => {
  it('totals 86 REST operations (79 panel + 4 server-only + 3 student)', () => {
    expect(PANEL_OPERATION_IDS.length).toBe(79);
    expect(SERVER_SIDE_ONLY_OPERATION_IDS.length).toBe(4);
    const panelSpecOps = operationIds(OPENAPI);
    expect(panelSpecOps.length).toBe(83); // 79 panel + 4 server-only quiz-sync
    const studentOps = operationIds(QUIZ_APP);
    expect(studentOps.length).toBe(3);
    expect(panelSpecOps.length + studentOps.length).toBe(86);
  });

  it('declares exactly 22 panel events', () => {
    expect(PANEL_EVENT_NAMES.length).toBe(22);
  });

  it('retains exactly five preview-signaling messages (compatibility inventory, no production client-domain mapping)', () => {
    const rows = [...EVENTS.matchAll(/^\|\s*`(offer|answer|ice|close|error)`\s*\|/gm)].map((m) => m[1]);
    expect(new Set(rows)).toEqual(new Set(['offer', 'answer', 'ice', 'close', 'error']));
    // `getSourcePreview` is the sole production preview transport → domain `preview`.
    expect(ADAPTER_DOMAINS).toContain('preview');
  });

  it('declares four device↔quiz sync messages and four student events', () => {
    const sync = [...EVENTS.matchAll(/^\|\s*`(sync\.[a-z]+)`\s*\|/gm)].map((m) => m[1]);
    expect(new Set(sync)).toEqual(new Set(['sync.hello', 'sync.answers', 'sync.participants', 'sync.heartbeat']));
    const studentEvents = [...EVENTS.matchAll(/^### 5\.\d+ .*`(quiz\.[a-z]+)`/gm)].map((m) => m[1]);
    expect(new Set(studentEvents)).toEqual(new Set(['quiz.question', 'quiz.result', 'quiz.participant', 'quiz.session']));
  });
});

describe('E-50 no-direct-network and adapter-honesty audit', () => {
  const APP_ROOTS = [resolve(REPO, 'apps/panel/src'), resolve(REPO, 'apps/quiz/src')];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('no panel/quiz app source constructs fetch, WebSocket, or RTCPeerConnection directly', () => {
    const offenders: string[] = [];
    for (const root of APP_ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, 'utf8');
        if (/\bnew\s+WebSocket\b/.test(src) || /\bnew\s+RTCPeerConnection\b/.test(src) || /\bwindow\.fetch\b/.test(src)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders, `direct networking in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no app source references removed WebRTC preview signaling (/ws/preview, SDP, ICE, RTCPeerConnection)', () => {
    const offenders: string[] = [];
    for (const root of APP_ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, 'utf8');
        if (/\/ws\/preview|RTCPeerConnection|createOffer|setLocalDescription|onicecandidate/.test(src)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders, `residual preview-signaling references in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no app source reads a build-time adapter env flag to select the adapter', () => {
    // The concern is adapter *selection*: a single built bundle must choose the
    // adapter only through /config.json, never `import.meta.env`/`process.env`.
    // An ambient `.d.ts` type or a prose comment is neither a read nor a branch.
    const flags = ['VITE_EDUSCOPE_REAL_API', 'VITE_EDUSCOPE_API_URL', 'NEXT_PUBLIC_EDUSCOPE_REAL_API'];
    const offenders: string[] = [];
    for (const root of APP_ROOTS) {
      for (const file of walk(root)) {
        if (file.endsWith('.d.ts')) continue;
        const src = readFileSync(file, 'utf8');
        for (const flag of flags) {
          if (new RegExp(`(import\\.meta\\.env|process\\.env)(\\.${flag}\\b|\\[['"\`]${flag}['"\`]\\])`).test(src)) {
            offenders.push(`${file}:${flag}`);
          }
        }
      }
    }
    expect(offenders, `build-time adapter selection in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the real adapter throws no reachable NotImplementedError', () => {
    const realDir = resolve(REPO, 'packages/api-client/src/real');
    const offenders: string[] = [];
    for (const file of walk(realDir)) {
      if (/throw new NotImplementedError/.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the mock adapter is still present (contract-regression harness kept)', () => {
    expect(statSync(resolve(REPO, 'packages/api-client/src/mock')).isDirectory()).toBe(true);
  });
});
