/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' selects createRealClient. Anything else uses the mock adapter. */
  readonly VITE_EDUSCOPE_REAL_API?: string;
  readonly VITE_EDUSCOPE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
