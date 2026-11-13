/** See `checked-in-parks.mjs`. */
import type { CheckedInPark, PrebuiltParksManifest } from '../../src/world/prebuilt/parkFileName';

export function restoreInstruction(seed: number | string): string;
export function parksDir(root: string): string;
export function parkFilePath(root: string, seed: number): string;
export function parkFileSha(bytes: string | Uint8Array): string;
export function readParksManifest(root: string): PrebuiltParksManifest | null;
export function writeParksManifest(root: string, manifest: PrebuiltParksManifest): void;
export function writeWhole(path: string, text: string): void;
export function checkedInParkText(park: Record<string, unknown>): string;
export function parkStampOf(layout: string, sourceHash: string): string;
export function checkedInPark(
  root: string,
  seed: number,
): { readonly entry: CheckedInPark; readonly path: string; readonly sha: string; readonly park: Record<string, unknown> };
export function servedParkText(root: string, seed: number, version: string, sourceHash?: string): string;
