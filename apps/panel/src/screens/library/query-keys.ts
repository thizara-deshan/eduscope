import type { LibraryFilters } from './use-recordings.js';

/** S-21/S-22 TanStack Query key factories. REST-backed reads only — WS-fed state lives in the store (selectors.ts). */
export const LIB_KEYS = {
  recordings: (filters: LibraryFilters) => ['library', 'recordings', filters] as const,
  recording: (recordingId: string | undefined) => ['library', 'recording', recordingId] as const,
};
