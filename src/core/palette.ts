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
