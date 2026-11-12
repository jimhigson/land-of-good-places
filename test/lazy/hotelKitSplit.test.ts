import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGlbParts, base64ToArrayBuffer } from '../../src/art/style/glb';
import { HOTEL_GLB_BASE64 } from '../../src/art/assets/hotelGlb';
import { HOTEL_INSIDE_GLB_BASE64 } from '../../src/art/assets/hotelInsideGlb';
import { isHotelBootPart } from '../../src/art/models/hotelKitSplit';

/**
 * `pack:hotel` cuts `hotel.glb` into a boot kit and an inside kit. The two
 * together must be the authored file, part for part and byte for byte — a part
 * lost, duplicated or garbled by the cut would be furniture missing, doubled or
 * wrong in the hotel, and nothing else reads the cut against its source.
 */
describe('the hotel kit split', () => {
  const whole = readGlbParts(new Uint8Array(readFileSync('src/art/assets/hotel.glb')).buffer);
  const boot = readGlbParts(base64ToArrayBuffer(HOTEL_GLB_BASE64));
  const inside = readGlbParts(base64ToArrayBuffer(HOTEL_INSIDE_GLB_BASE64));

  it('puts every authored part in exactly one kit, the one hotelKitSplit names', () => {
    expect(whole.size).toBeGreaterThan(80);
    for (const name of whole.keys()) {
      const inBoot = boot.has(name);
      const inInside = inside.has(name);
      expect(inBoot !== inInside, `${name} in boot ${inBoot}, inside ${inInside}`).toBe(true);
      expect(inBoot, name).toBe(isHotelBootPart(name));
    }
    expect(boot.size + inside.size).toBe(whole.size);
  });

  it('carries every part over unchanged', () => {
    for (const [name, part] of whole) {
      const cut = boot.get(name) ?? inside.get(name);
      expect(cut, name).toBeDefined();
      if (!cut) continue;
      expect(cut.position.toArray(), name).toEqual(part.position.toArray());
      expect(cut.quaternion.toArray(), name).toEqual(part.quaternion.toArray());
      expect(Object.keys(cut.geometry.attributes).sort(), name).toEqual(Object.keys(part.geometry.attributes).sort());
      for (const [attribute, value] of Object.entries(part.geometry.attributes)) {
        const other = cut.geometry.getAttribute(attribute);
        expect(Array.from(other.array as ArrayLike<number>), `${name}.${attribute}`).toEqual(Array.from(value.array as ArrayLike<number>));
      }
      expect(Array.from((cut.geometry.index?.array ?? []) as ArrayLike<number>), `${name} index`).toEqual(
        Array.from((part.geometry.index?.array ?? []) as ArrayLike<number>),
      );
    }
  });
});
