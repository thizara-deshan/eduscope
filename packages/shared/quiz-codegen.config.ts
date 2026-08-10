import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../contracts/quiz-app.yaml',
  output: { path: 'src/schemas/quiz-generated' },
  plugins: [
    { name: '@hey-api/typescript', exportInlineEnums: true },
    { name: 'zod', exportFromIndex: false },
  ],
});
