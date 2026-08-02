import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../contracts/openapi.yaml',
  // No `format:` option — that would pull in prettier, which this workspace does
  // not use. `generated/` is ESLint-ignored and never hand-read; the coverage
  // test, not its formatting, is what makes it trustworthy.
  output: { path: 'src/schemas/generated' },
  plugins: [
    { name: '@hey-api/typescript', exportInlineEnums: true },
    { name: 'zod', exportFromIndex: false },
  ],
});
