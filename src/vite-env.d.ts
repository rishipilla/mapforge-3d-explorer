/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OVERPASS_API_URL?: string;
  readonly VITE_OVERPASS_FALLBACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
