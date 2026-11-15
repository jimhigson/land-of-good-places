/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The current commit, injected by `vite.config.ts`'s `define`. */
declare const __APP_VERSION__: string;
/** When the bundle was built (ISO), injected by `vite.config.ts`'s `define`; read only by `build-identity.ts`. */
declare const __APP_BUILT_AT__: string;
