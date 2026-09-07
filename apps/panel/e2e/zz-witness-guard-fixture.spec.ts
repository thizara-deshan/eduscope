import { test } from '@playwright/test';

// Reserved for `test/real/contract-honesty.test.ts`'s "declares no real
// witness" guard check. Never add a real adapter annotation to this spec —
// every screen spec is expected to eventually gain one (E-07..E-50), so the
// guard test needs one file that permanently does not.
test.skip('reserved: no screen behavior lives here', () => {});
