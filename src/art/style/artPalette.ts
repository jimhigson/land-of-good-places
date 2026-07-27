import { PALETTE } from './bridge';

/**
 * Character and prop colours — an EXTENSION of `src/core/palette.ts`, never a
 * replacement. Anything the world already names (grass, bark, stonePink, ink…)
 * must be taken from PALETTE. This file only adds colours that belong to a
 * specific cute thing.
 *
 * The rule that keeps the park coherent: every colour here is a **toy colour**.
 * Saturated but never neon, light but never washed out, and the darkest value in
 * the whole game is PALETTE.ink (0x4a3a52) — a warm plum, never black.
 */
export const ART = {
  // --- shared character kit ------------------------------------------------
  /** The one and only "line" colour. Eyes, mouths, outlines all resolve to this. */
  ink: PALETTE.ink,
  /** Eye catchlight / tooth / eye-white. Warm, not #fff. */
  shine: 0xfffdf8,
  /** Default blush. */
  blush: PALETTE.cheek,
  /** Soft neutral for tummies, muzzles and paw pads. */
  cream: 0xfff3e2,
  creamDark: 0xf3ddc2,

  // --- RiPika (electric yellow mouse) --------------------------------------
  ripikaYellow: 0xffd63f,
  ripikaYellowDeep: 0xf2b724,
  ripikaBelly: 0xfff0b0,
  /** Ear tips and tail root — a warm cocoa, never black. */
  ripikaTip: 0x7a5340,
  ripikaCheek: 0xff5f5a,
  ripikaCheekDark: 0xe8464a,
  ripikaBolt: 0xffb52e,

  // --- Biscuit (teddy bear) -------------------------------------------------
  biscuitFur: 0xdca873,
  biscuitFurDark: 0xc28a58,
  biscuitMuzzle: 0xf8e2c2,
  biscuitInnerEar: 0xffb9c9,
  biscuitNose: 0x8c5f4a,
  jumperRed: 0xef5a52,
  jumperRedDark: 0xd4413e,
  heartPink: 0xffb3d1,
  heartCream: 0xfff1e4,

  // --- Balloons -------------------------------------------------------------
  balloonString: 0xfaeee0,
  balloonSheen: 0xffffff,

  dalmatianWhite: 0xfffaf4,
  dalmatianSpot: 0x574d5e,
  dalmatianEar: 0x6b6070,
  helmetRed: 0xe94c42,
  helmetGold: 0xffd166,

  corgiTan: 0xf2a85c,
  corgiTanDark: 0xdb8e45,
  corgiCream: 0xfff3e0,
  gogglePink: 0xff8fc0,
  goggleGlass: 0xffd9ec,
  wingWhite: 0xfff7fb,

  chickenWhite: 0xfffbf4,
  chickenShade: 0xf3e6d6,
  chickenComb: 0xf25b58,
  chickenBeak: 0xffb13d,
  chickenSack: 0xcbb391,

  // --- Mini (Mayhem mischief) ----------------------------------------------
  miniLilac: 0xb693f2,
  miniLilacDark: 0x9670dc,
  miniBelly: 0xa9f0d5,
  miniHorn: 0xfff0c2,
  miniTooth: 0xfffdf8,

  // --- Player kid defaults --------------------------------------------------
  kidSkin: PALETTE.skin,
  kidHair: PALETTE.hair,
  kidOutfit: PALETTE.outfit,
  kidOutfitDark: PALETTE.outfitDark,
  kidShoe: PALETTE.shoe,
  kidBackpack: 0x7fe3c0,
  kidBackpackDark: 0x5fc9a6,
  kidBobble: 0xffd166,
  /** Default iris colour, named so a retune has somewhere to live. */
  kidEye: PALETTE.iris,
  /** Ethan's eyes — a family request (see NpcSystem.ts). */
  kidEyeBlue: 0x4fb0e8,
  /**
   * Extra eye colours baked into the NPC crowd's instanced face-material set
   * (see `entities/npc/kidCrowd.ts`'s `EYE_VARIANTS`) alongside the default
   * violet and Ethan's blue. The character creator offers a couple more
   * (hazel, grey) that only ever paint the player's own, non-instanced face,
   * so they don't need a texture set of their own here.
   */
  kidEyeBrown: 0x6b4a30,
  kidEyeGreen: 0x4f9a70,
  /** Ethan's hair — a family request (see NpcSystem.ts). */
  kidHairBlonde: 0xf0d48a,

  // --- props ----------------------------------------------------------------
  lollipopStick: PALETTE.bark,
  lollipopLeaf: PALETTE.leafMid,
  lollipopLeafAlt: 0x74d489,
  lollipopBerry: 0xff8f8f,

  // --- effects ---------------------------------------------------------------
  /**
   * The park's rainbow, inner band first. Used by the hop ring.
   *
   * These are toy-shop rainbow colours, not spectrum ones: every band is pulled
   * a long way towards cream, so the ring reads as painted ribbon rather than as
   * a neon test pattern sitting on the grass. Indigo is dropped — six bands is
   * as many as survives being 40 pixels wide on a phone.
   */
  rainbow: [0xff8f8f, 0xffbe6b, 0xffe27a, 0x8fdf8a, 0x8cc9ff, 0xc9a9ff],

  // --- gallery staging only (NOT for the game world) ------------------------
  stageFloor: 0xfdf7ec,
  stagePlinthA: 0xffd9ec,
  stagePlinthB: 0xc9edff,
  stagePlinthC: 0xd8f5cf,
  stagePlinthD: 0xffe9b8,
  stageBackTop: 0xbfe6ff,
  stageBackBottom: 0xfff3e4,
} as const;

export type ArtKey = keyof typeof ART;
