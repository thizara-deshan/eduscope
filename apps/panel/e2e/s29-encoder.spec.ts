import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

async function signIn(page: Page, username = 'admin', password = 'battery-staple') {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToEncoder(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Encoder Settings/ }).click();
  await expect(page.locator('[data-screen="S-29"]')).toBeVisible();
}

test.describe('S-29 Encoder Settings', () => {
  test('primary: only H.264 is offered; the bitrate stepper moves; Save shows the applies-next-session notice', async ({ page }) => {
    await signIn(page);
    await goToEncoder(page);

    await expect(page.getByText('h264')).toBeVisible();
    await expect(page.getByText(/h265|hevc|av1/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Increase bitrate' }).click();
    await expect(page.getByText(/never applies mid-lecture/)).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('bitrate-readout')).toContainText('4250');
  });

  test('failure: a bitrate pushed above the capability max is rejected (422) and not applied', async ({ page }) => {
    await signIn(page);
    await goToEncoder(page);

    for (let i = 0; i < 17; i += 1) {
      await page.getByRole('button', { name: 'Increase bitrate' }).click();
    }
    await expect(page.getByTestId('bitrate-readout')).toContainText('8250');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText("Bitrate is outside the encoder's capabilities.")).toBeVisible({ timeout: 5_000 });
  });
});

interface EncodingProfileRow {
  readonly scope: 'device-default' | 'channel';
  readonly channelId: string | null;
  readonly videoBitrateKbps: number;
  readonly framerate: number;
  readonly gop: number;
  readonly rateControl: string;
  readonly audioBitrateKbps: number;
}

interface PmCall {
  readonly method: string;
  readonly path: string;
  readonly body?: { videoBitrateBps?: number; fps?: number; gop?: number; rateControl?: string; audioBitrateBps?: number };
}

const SOURCES_ONLINE = {
  publishers: {
    usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
  },
  consumers: [{ id: 'record:00000001', state: 'running', pgid: 7101 }],
} as const;

realTest.describe('S-29 Encoder Settings — real', () => {
  realTest(
    'real: a streaming-scoped override reaches only the next PM live-start profile while local recording keeps the device default, and unsupported values are rejected',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await realStack.control('core.start');
      await realStack.control('core.pm.status', { status: SOURCES_ONLINE });

      const base = realStack.coreBaseUrl;
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.admin, client: 'panel' }),
      });
      const { tokens } = await login.json() as { tokens: { accessToken: string } };
      const auth = { authorization: `Bearer ${tokens.accessToken}` };
      const jsonAuth = { 'content-type': 'application/json', ...auth };

      // --- Device default (no channelId) ---
      const deviceDefault = await (await fetch(`${base}/settings/encoder`, { headers: auth })).json() as { profile: EncodingProfileRow };
      realExpect(deviceDefault.profile).toMatchObject({ scope: 'device-default', channelId: null, videoBitrateKbps: 4000, framerate: 30 });

      // --- Streaming scope with no override yet inherits the device default verbatim ---
      const inherited = await (await fetch(`${base}/settings/encoder?channelId=streaming`, { headers: auth })).json() as { profile: EncodingProfileRow };
      realExpect(inherited.profile).toMatchObject({ scope: 'device-default', videoBitrateKbps: 4000, framerate: 30 });

      // --- An unsupported value is rejected outright, never clamped ---
      const unsupported = await fetch(`${base}/settings/encoder`, {
        method: 'PUT', headers: jsonAuth, body: JSON.stringify({ channelId: 'streaming', gop: 45 }),
      });
      realExpect(unsupported.status).toBe(422);
      realExpect((await unsupported.json() as { code: string }).code).toBe('config.invalid');
      const stillInherited = await (await fetch(`${base}/settings/encoder?channelId=streaming`, { headers: auth })).json() as { profile: EncodingProfileRow };
      realExpect(stillInherited.profile.scope, 'a rejected patch never creates an override row').toBe('device-default');

      // --- A valid streaming-scoped override writes only that channel's row ---
      const setOverride = await fetch(`${base}/settings/encoder`, {
        method: 'PUT', headers: jsonAuth, body: JSON.stringify({ channelId: 'streaming', videoBitrateKbps: 6000, framerate: 25 }),
      });
      realExpect(setOverride.status).toBe(200);
      const overridden = await (await fetch(`${base}/settings/encoder?channelId=streaming`, { headers: auth })).json() as { profile: EncodingProfileRow };
      realExpect(overridden.profile).toMatchObject({ scope: 'channel', channelId: 'streaming', videoBitrateKbps: 6000, framerate: 25 });
      const deviceDefaultAfter = await (await fetch(`${base}/settings/encoder`, { headers: auth })).json() as { profile: EncodingProfileRow };
      realExpect(deviceDefaultAfter.profile, 'the device default is untouched by a channel-scoped write').toMatchObject({ scope: 'device-default', videoBitrateKbps: 4000, framerate: 30 });

      // --- Start a real local recording: the next PM record-start profile is the untouched device default ---
      const start = await fetch(`${base}/recording/start`, { method: 'POST', headers: auth });
      realExpect(start.status).toBe(202);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 7101 },
      });
      await realExpect.poll(async () => {
        const state = await (await fetch(`${base}/recording/state`, { headers: auth })).json() as { state: string };
        return state.state;
      }).toBe('recording');

      const ledgerAfterRecord = await realStack.ledger();
      const recordCall = (ledgerAfterRecord.pm as PmCall[]).findLast((call) => call.method === 'POST' && call.path === '/consumers/record');
      realExpect(recordCall?.body).toMatchObject({ videoBitrateBps: 4_000_000, fps: 30, gop: 60, rateControl: 'cbr', audioBitrateBps: 128_000 });

      // --- Enable real streaming: the next PM live-start profile reflects the streaming override ---
      const target = await fetch(`${base}/settings/stream-targets`, {
        method: 'POST', headers: jsonAuth,
        body: JSON.stringify({ platform: 'custom-rtmp', displayName: 'E29 target', ingestUrl: 'rtmp://ingest.example.edu/live', streamKey: 'e29-key' }),
      });
      const { id: targetId } = await target.json() as { id: string };
      await fetch(`${base}/channels/streaming`, {
        method: 'PUT', headers: jsonAuth, body: JSON.stringify({ streamTargetIds: [targetId] }),
      });
      const enableStream = await fetch(`${base}/channels/streaming/enable`, { method: 'POST', headers: auth });
      realExpect(enableStream.status).toBe(202);
      await realExpect.poll(async () => {
        const ledger = await realStack.ledger();
        return (ledger.pm as PmCall[]).some((call) => call.method === 'POST' && call.path === '/consumers/live');
      }, { timeout: 10_000 }).toBe(true);
      const ledgerAfterLive = await realStack.ledger();
      const liveCall = (ledgerAfterLive.pm as PmCall[]).findLast((call) => call.method === 'POST' && call.path === '/consumers/live');
      realExpect(liveCall?.body).toMatchObject({ videoBitrateBps: 6_000_000, fps: 25 });

      // --- The screen itself renders only the real, unaffected device default (no channel picker exists) ---
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      const ack = page.getByRole('button', { name: /^Acknowledge/ });
      if (await ack.isVisible().catch(() => false)) await ack.click();
      await page.getByRole('button', { name: /Encoder Settings/ }).click();
      await realExpect(page.locator('[data-screen="S-29"]')).toBeVisible();
      await realExpect(page.getByTestId('bitrate-readout')).toContainText('4000');
      await realExpect(page.getByText('h264')).toBeVisible();
    },
  );
});
