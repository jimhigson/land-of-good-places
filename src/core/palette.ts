/**
 * The colour bible for Land of Good Places.
 *
 * Rule of thumb for new art: bright and saturated, but softened towards cream
 * rather than white, and never pure black. If a colour looks like it belongs on
 * a plastic toy, it belongs in this game.
 *
 * Values are plain hex numbers so they can be handed straight to three.js
 * materials (`new MeshStandardMaterial({ color: PALETTE.grass })`).
 */
export const PALETTE = {
  // ground
  grass: 0x86d36a,
  grassDark: 0x63bb52,
  grassLight: 0xa8e57f,
  pathSand: 0xf3ddb2,
  pathSandDark: 0xe3c691,
  pathEdge: 0xffeecb,

  // foliage
  leafMid: 0x5fc86b,
  leafLight: 0x8ae08a,
  leafDeep: 0x3fa25b,
  leafBlue: 0x63c9a8,
  bark: 0xa9755a,
  barkDark: 0x8a5a45,

  // blossom / flowers
  blossomPink: 0xffa9d4,
  blossomWhite: 0xfff3f8,
  flowerYellow: 0xffe066,
  flowerRed: 0xff8f8f,
  flowerBlue: 0xa9c8ff,
  flowerViolet: 0xd7b3ff,

  // built things
  stonePink: 0xffc2d8,
  stonePinkDark: 0xf0a3c1,
  stonePinkLight: 0xffe0ec,

  /**
   * **The park's stone grey.** One colour; the four either side of it are its
   * tonal steps, not four more colours.
   *
   * ## Why this exact grey (ART_DIRECTION §5)
   *
   * §5's test for a new colour is *"would it look right on a plastic toy?"* —
   * bright and saturated but softened towards cream, never neon, never washed
   * out. A grey is the awkward case for that test, because the obvious answer
   * fails it: a **neutral** grey (`0xcccccc` and friends) put next to this
   * park's {@link PALETTE.stonePink} (0xffc2d8) reads as a hole punched in the
   * picture. Nothing else here is desaturated, so a genuinely desaturated
   * object stops looking like stone and starts looking like missing texture.
   *
   * So this grey is not neutral. R 211, G 202, B 203: a nine-point red lift
   * carries the park's warmth, and blue held a single point above green tips it
   * to the faintest rose rather than to cream. That whisper of rose is what
   * relates it to the pink stone the rest of the park is built from — it reads
   * unmistakably as *grey*, which is what the family asked for, while still
   * belonging to a park whose masonry is pink.
   *
   * ## Why it is light, not dark (ART_DIRECTION §6)
   *
   * The toon ramp's darkest band sits at ~68% perceived brightness, so
   * everything in this park is *already* lifted off its own shadow. Starting
   * dark leaves the shaded side muddy, and §2 is emphatic that the shadow side
   * must stay obviously the same colour, only cosier. At night, a light stone
   * takes what uplight there is and reads as pale carved rock; a dark one
   * swallows it and disappears.
   *
   * ## Why it lives here rather than in `art/style/artPalette.ts`
   *
   * It used to live there, because the fountain statue was the only thing cut
   * from it. Three things in the *world* are now: the rail race's trestles, the
   * Spooky House's walls, and — issue #477 — the entrance road the cat bus
   * arrives on. `artPalette.ts`'s own first paragraph says colours the world
   * names belong in this file, and moving it here is what let `core/textures.ts`
   * paint a grey road at all: the art system re-exports `core/textures.ts`
   * (`art/style/bridge.ts` is *"the ONLY file in the art system that reaches
   * into `src/`"*), so a texture importing `ART` closes a module cycle and
   * `ART` is still in its temporal dead zone when the road's tone table is
   * built. `ART.statueStone*` remains, reading from here, so nothing that was
   * carved from this rock has to know it moved.
   *
   * Stays well clear of {@link PALETTE.ink} (0x4a3a52). Nothing in this game
   * goes darker than that plum.
   */
  stoneGrey: 0xd3cacb,
  /** One step up — the statue's cream tummy, the road's brightest slabs. */
  stoneGreyLight: 0xe8e1e0,
  /** One step down — the plinth's drum, the road's mortar and kerb bedding. */
  stoneGreyMid: 0xb9afb1,
  /** Two steps down — the plinth's courses, the statue's cheek discs. */
  stoneGreyDeep: 0x9d9296,
  /** The darkest step — the Spooky House's walls, the statue's ear tips. */
  stoneGreyDark: 0x7e7379,
  wood: 0xd2a06a,
  woodDark: 0xb37f4f,
  woodLight: 0xe6bd8c,
  signBoard: 0xfff2dc,

  // the big building
  // Alternating cream and blossom storeys give the tower a layer-cake look.
  buildingWall: 0xfff3e2,
  buildingWallDark: 0xffc4dd,
  buildingWindow: 0x9adcff,
  buildingWindowWarm: 0xffe08a,
  buildingTrim: 0xffb0cf,
  buildingTrimDeep: 0x8ddcc0,
  buildingFloor: 0xffdaea,
  buildingFloorAlt: 0xc9e8fb,
  buildingRoof: 0x9fe0ff,
  buildingRoofDeep: 0x5fb5e8,
  glassTint: 0xcdeeff,
  liftFrame: 0xffd76e,
  escalatorStep: 0xb7e6ff,
  escalatorRail: 0x7fbde0,
  trampolinePad: 0x8f7fe8,
  trampolineRim: 0xff9ad0,
  bubbleSkin: 0xcdf3ff,
  slideChute: 0xffc95c,
  slideChuteDeep: 0xf0a52f,
  slideRail: 0xff7fae,
  ballPitA: 0xff8fc0,
  ballPitB: 0x7fe3c0,
  ballPitC: 0xffdf7a,
  ballPitD: 0x87c9ff,
  ballPitE: 0xc9a9ff,
  grownUpCoat: 0x7fb3f2,
  grownUpScarf: 0xff9ad0,

  // water
  waterTop: 0x8fe3ff,
  waterDeep: 0x4fbfe8,
  waterFoam: 0xf2fdff,

  // character
  skin: 0xffd9be,
  hair: 0x8b5a3c,
  outfit: 0xff9fc4,
  outfitDark: 0xef7fae,
  shoe: 0x7fc4ff,
  eyeWhite: 0xfffdf8,
  eyeDark: 0x3b2d3f,
  /** Default iris colour — see `ART.kidEye`. A warm violet, not a "realistic" one. */
  iris: 0x6f4b9a,
  /**
   * Default backpack colour — see `ART.kidBackpack`, which now takes it from
   * here. It moved down out of `ART` when the backpack became a choice: the
   * store has to name a starting colour for a brand-new character, and
   * `state/` never imports `art/` (see `state/types.ts`'s header).
   */
  backpack: 0x7fe3c0,
  cheek: 0xff9db4,

  // sky & light
  skyDayTop: 0x4aa9f0,
  skyDayBottom: 0xc6ecff,
  skySunsetTop: 0x5a63b8,
  skySunsetBottom: 0xffb078,
  skyNightTop: 0x121a3d,
  skyNightBottom: 0x36407a,
  skyDawnTop: 0x6f7fc8,
  skyDawnBottom: 0xffd2c4,

  sunDay: 0xfff4d6,
  sunSet: 0xff9a5c,
  moon: 0xdfe8ff,

  ambientDay: 0xcfe9ff,
  ambientNight: 0x2f3a6b,

  fairyWarm: 0xffcf7a,
  fairyPink: 0xff9ad0,
  fairyMint: 0x9df2d0,
  fairyBlue: 0x9ad4ff,

  // ui / markers
  markerPink: 0xff8fc0,
  markerMint: 0x7fe3c0,
  markerSky: 0x87c9ff,
  markerLemon: 0xffdf7a,
  markerLilac: 0xc9a9ff,
  ink: 0x4a3a52,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Hex number to a `#rrggbb` string, for canvas / CSS work. */
export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
