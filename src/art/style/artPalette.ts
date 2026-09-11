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

  // --- carved grey stone ----------------------------------------------------
  //
  // **Moved to `PALETTE.stoneGrey*`, and read from there.** These five were
  // defined here when the fountain statue was the only thing cut from them.
  // Three things in the world are now — the rail race trestles, the Spooky
  // House walls, and the entrance road the cat bus arrives on (#477) — and this
  // file's own first paragraph says a colour the world names belongs in
  // `core/palette.ts`. The full account of why this exact grey, and why it is
  // light rather than dark, went with the values.
  //
  // The names stay so that nothing carved from this rock has to know it moved,
  // and they are read rather than copied: a second definition of one colour is
  // this repo's most expensive bug shape, and a grey is exactly where it would
  // hide — five near-identical hex numbers nobody would ever spot drifting.
  /** @see PALETTE.stoneGrey — the park's stone grey, and why it is not neutral. */
  statueStone: PALETTE.stoneGrey,
  /** One step up — the cream tummy and collar flash in stone. */
  statueStoneLight: PALETTE.stoneGreyLight,
  /** One step down — the cowlick tuft, the thighs, the plinth's drum. */
  statueStoneMid: PALETTE.stoneGreyMid,
  /** Two steps down — the tail's tip, the cheek discs, the plinth's courses. */
  statueStoneDeep: PALETTE.stoneGreyDeep,
  /** The darkest step — ear tips, feet, paws, the painted nose. */
  statueStoneDark: PALETTE.stoneGreyDark,

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

  // --- castle fire ------------------------------------------------------------
  /**
   * The **emissive** a castle torch burns with — deliberately deeper and redder
   * than the amber the cone is painted in.
   *
   * This is a colour for light, not for pigment, and it exists because an
   * emissive term is *multiplied and then clipped*. The torches were emitting
   * `PALETTE.slideChuteDeep` (0xf0a52f) at 1.75, which is `(1.00, 1.00, 0.32)`
   * once the red and green channels have saturated — a flat lemon yellow with
   * no red left in it at all, sitting inside a core clipped to pure white. From
   * the game camera that is a small pale cream dot, which is what a reviewer
   * reported seeing and what "make it hotter" is asking to fix. It is also
   * ART_DIRECTION §5's "never washed out" and §6's objection to ACES
   * desaturating bright colours towards white, arrived at from the other
   * direction.
   *
   * At the same 1.75 this lands on `(1.00, 0.45, 0.43)` — a hot orange-red. The
   * flame then has somewhere to go: red-orange sheath, cream core, which is a
   * *fire*, where two clipped yellows stacked on each other were a smudge.
   * Bright and saturated, softened towards cream rather than white, and it
   * would look right on a plastic toy.
   */
  castleFlameDeep: 0xd4413e,

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

  // --- the castle's interior dressing (#363) --------------------------------
  /**
   * **Polished steel** — a suit of armour, a chandelier's wheel, a torch's
   * bracket, a halberd's blade.
   *
   * The park has no metal colour, and the two nearest existing ones are both
   * wrong for it: `statueStone` (0xd3cacb) is *carved rock*, warm and chalky,
   * and armour painted in it reads as a garden ornament; `glassTint`
   * (0xcdeeff) is ice and has no weight at all. This is a pale pewter with a
   * clear blue cast — the same trick `statueStone` plays with rose, pointed
   * the other way, so steel and stone stand next to each other in one room and
   * are obviously two different materials rather than two greys.
   *
   * Bright, and deliberately so. ART_DIRECTION §2's metalness rule is absolute
   * (`metalness` stays 0, everything is matte painted wood), so "metal" here
   * has to be carried entirely by hue and value against the four-band toon
   * ramp. A dark steel bands into mud on the shadow side; this one keeps three
   * distinguishable bands, which is what actually reads as a polished plate.
   */
  castleSteel: 0xc6d2e2,
  /**
   * **Black iron** — the parts of a fitting that are wrought rather than
   * polished: a torch bracket's strap, a brazier's legs, a chandelier's chain,
   * a visor slit, a portcullis.
   *
   * Never black, per §5 — this is `castleSteel` taken a long way down and
   * warmed slightly, and it sits comfortably above `PALETTE.ink` (0x4a3a52),
   * which is the floor for every colour in this file. It is the *outline*
   * colour's neighbour, not its twin: ink-tinting an outline round something
   * already this dark would be a black line, which §4 bans, so the iron parts
   * take a thinner outline or none.
   */
  castleIron: 0x8a93a6,
  /**
   * **Tapestry cloth** — the woven ground a picture is dyed into.
   *
   * A deep rose that is unmistakably *cloth* next to the pink stone it hangs
   * on. `PALETTE.stonePinkDark` (0xf0a3c1) is the park's own masonry, and a
   * hanging in that colour disappears into the wall behind it; this is two
   * steps down and two steps warmer, so the tapestry is the first thing the
   * eye finds on a wall and the wall is still pink.
   *
   * It is the **ground**, not the picture: the heraldry is a canvas texture
   * multiplied over this, so a tapestry in shadow is a darker tapestry rather
   * than a grey rectangle.
   */
  castleTapestry: 0xc4577f,

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
