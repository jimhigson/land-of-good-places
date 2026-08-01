// No `@types/node` in this project (a browser game has no business seeing
// `process`, `Buffer`, `require`, etc as ambient globals in `src/`) — this
// declares only the two Node functions `vite.config.ts` actually calls, by
// hand, rather than pulling in the whole ambient Node surface.
declare module 'child_process' {
  export function execSync(command: string): { toString(): string };
}
declare module 'fs' {
  export function writeFileSync(path: string, data: string): void;
}
