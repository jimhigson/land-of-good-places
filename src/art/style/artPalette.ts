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

  // --- carved grey stone (the fountain statue) ------------------------------
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
   * park's `PALETTE.stonePink` (0xffc2d8) reads as a hole punched in the
   * picture. Nothing else here is desaturated, so a genuinely desaturated
   * object stops looking like stone and starts looking like missing texture.
   *
   * So this grey is not neutral. R 211, G 202, B 203: a nine-point red lift
   * carries the park's warmth, and blue held a single point above green tips it
   * to the faintest rose rather than to cream. That whisper of rose is what
   * relates it to the pink stone the rest of the fountain is built from — it
   * reads unmistakably as *grey*, which is what the family asked for, while
   * still belonging to a park whose masonry is pink.
   *
   * §5 also forbids redefining something the world already names. This does not:
   * `PALETTE.stonePink*` is the pink cobble the basin and rim are made of, and a
   * grey statue is a different material standing on it, not a second opinion
   * about the same one.
   *
   * ## Why it is light, not dark (ART_DIRECTION §6)
   *
   * Checked against §6's authoring light, because a stone that reads right at
   * noon can go dead after dark. Two pressures both push the same way:
   *
   *  - The toon ramp's darkest band sits at ~68% perceived brightness, so
   *    everything in this park is *already* lifted off its own shadow. Starting
   *    dark leaves the shaded side muddy, and §2 is emphatic that the shadow
   *    side must stay obviously the same colour, only cosier.
   *  - At night the statue's only real light is the fountain's own cyan
   *    `PointLight`, sitting below it in the water. A light stone takes that
   *    uplight and reads as pale carved rock; a dark stone swallows it and the
   *    statue disappears into the plaza exactly when the fountain is supposed
   *    to be the bright thing in the middle of it.
   *
   * ## Why a ladder and not one flat grey
   *
   * The statue is RiPika built in stone rather than a second model of her
   * (`models/ripikaStatue.ts`), so each step substitutes for one of the yellow
   * mouse's colours. Collapse them all to one grey and the cocoa ear tips, the
   * cream tummy and the amber tail tip vanish — the statue reads as an
   * undifferentiated lump at gameplay distance, which is the exact failure the
   * cream tummy exists to prevent on the live mouse (see `ripika.ts`).
   *
   * The steps are therefore ordered by **the luminance of the colour each one
   * replaces** — belly (lightest) → yellow → yellowDeep → bolt → tip (darkest)
   * — so the markings survive the trip to stone as tonal steps instead of hue
   * changes. This is also how the world already treats stone: `PALETTE`
   * carries `stonePink`, `stonePinkDark` and `stonePinkLight` for one material.
   * All five hold the same faint rose lean, so they read as one rock.
   *
   * `statueStoneDark` stays well clear of `PALETTE.ink` (0x4a3a52). Nothing in
   * this game goes darker than that plum.
   */
  statueStone: 0xd3cacb,
  /** One step up — the cream tummy and collar flash in stone. */
  statueStoneLight: 0xe8e1e0,
  /** One step down — the cowlick tuft, the thighs, the plinth's drum. */
  statueStoneMid: 0xb9afb1,
  /** Two steps down — the tail's tip, the cheek discs, the plinth's courses. */
  statueStoneDeep: 0x9d9296,
  /** The darkest step — ear tips, feet, paws, the painted nose. */
  statueStoneDark: 0x7e7379,

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
  kidBackpack: PALETTE.backpack,
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

  // --- the jet pack ---------------------------------------------------------
  /**
   * A coral rocket with a sky-blue harness, because the two things it must read
   * as from across the park are *rocket* and *toy*. Deliberately not a metal
   * grey: nothing in this park is metal (ART_DIRECTION §2), and a chrome
   * cylinder on a child's back would be the one prop that looks visited from
   * another game.
   */
  jetpackTank: 0xff9a7a,
  jetpackTankDark: 0xe8795c,
  jetpackTrim: 0x8cd8ff,
  /** The nozzle cones. A soft blue-grey — the darkest thing on the model. */
  jetpackNozzle: 0x9fc4de,
  /** Painted flames, in two bands. Pigment, never light — see §"Effects". */
  jetpackFlame: 0xffb45c,
  jetpackFlameCore: 0xffe9a8,

  // --- glasses ----------------------------------------------------------------
  /**
   * Sunglasses, star glasses and heart glasses for the character creator
   * (`art/models/glasses.ts`). Frames reuse an existing named colour wherever
   * one already fits the shape (stars are yellow, hearts are `heartPink`); a
   * lens tint is added fresh only where nothing already matches — a *tint*,
   * because every lens is transparent (ART_DIRECTION.md — see that file's
   * header for the transparency convention this follows).
   */
  glassesSunFrame: PALETTE.flowerRed,
  glassesSunLens: 0xc98a52,
  glassesStarFrame: PALETTE.flowerYellow,
  glassesStarLens: 0xfff0a8,
  glassesHeartLens: 0xffd6e8,

  // --- props ----------------------------------------------------------------
  lollipopStick: PALETTE.bark,
  lollipopLeaf: PALETTE.leafMid,
  lollipopLeafAlt: 0x74d489,
  lollipopBerry: 0xff8f8f,

  // --- Spooky House interior (#294, dark green on dark grey) ----------------
  /**
   * Jim, on PR #294's preview: "the background should also be generally dark
   * and spooky artwork in it such as spider webs, dark green on dark grey".
   * The grey half of that ask already exists — `statueStoneDark` above is
   * warm-toned and "stays well clear of `PALETTE.ink`", exactly what a wall
   * here needs — so only the green is new. Same rule as everywhere else in
   * this file: never darker than `PALETTE.ink` (0x4a3a52, L≈0.28 in HSL).
   * This is `PALETTE.leafDeep` (the park's own forest green) mixed 55/45
   * toward `PALETTE.ink` — a deep, warm forest green (L≈0.36), not a
   * desaturated "spooky" grey-green, so it still reads as a toy colour next
   * to the grey walls rather than as a hole in the picture.
   */
  spookyGreen: 0x447357,

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
