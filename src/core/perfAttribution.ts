import type { WebGLRenderer } from 'three';

/**
 * **`?perf=1` — what the slowest frames were doing**, not just how long they
 * took (the copy-JSON's `slowestFrames`).
 *
 * The probe (`core/perfProbe.ts`) says a frame took 247 ms of main thread. It
 * cannot say *why*, and on a phone in a parent's hand nothing else can either:
 * no profiler, no trace, only what this game writes into the JSON it copies.
 * So this records, for every frame, the handful of things that can stop a
 * frame dead — and the copy names the eight worst with their reasons.
 *
 * ## What is counted, and where the time is caught
 *
 * The WebGL context's own methods are wrapped **on the context instance**
 * (three.js calls them as `gl.method(...)`, so an own property shadows the
 * prototype's) — only these, and only under `?perf=1`:
 *
 * - **A program's first use — the link wait.** three.js links a program when
 *   it is asked for and asks the GPU about it the first time it is drawn with
 *   (`WebGLProgram.getUniforms` → `onFirstUse`). With
 *   `KHR_parallel_shader_compile` the link runs in the GPU process, and that
 *   first question is what blocks until it is done. Which question it is
 *   depends on the build: with `debug.checkShaderErrors` on (dev) it is
 *   `getProgramInfoLog`; off (the build the family plays) there is no error
 *   check at all, and it is `getProgramParameter(ACTIVE_UNIFORMS)` in
 *   `WebGLUniforms`' constructor — once per program, in both builds, which is
 *   what counts a first use. Every status query before it (the info logs,
 *   `LINK_STATUS`) is that program's wait too.
 * - **Introspection** — `getActiveUniform`, `getUniformLocation`,
 *   `getActiveAttrib`, `getAttribLocation`, `ACTIVE_ATTRIBUTES`: the rest of a
 *   first use, a synchronous round trip each where WebGL lives in another
 *   process, as it does in Safari.
 * - **Link and compile requests** — `linkProgram`, `compileShader`. Cheap
 *   where the link is parallel; the whole link where it is not.
 * - **`COMPLETION_STATUS_KHR` polls** — the non-blocking question a warm-up
 *   asks (`viewWarmup.ts`), counted apart so it is never mistaken for a wait.
 * - **Texture uploads** — `tex(Sub)Image2D/3D` and the compressed forms, with
 *   bytes *estimated* (an image source as RGBA8: an upload's real size is the
 *   driver's business). `texStorage*` and `generateMipmap` add to the time.
 * - **Buffer uploads** — `bufferData`, `bufferSubData`.
 * - **Other synchronous queries** — `getParameter`, `getError`,
 *   `checkFramebufferStatus`, `readPixels`, `finish`, `clientWaitSync`,
 *   `getBufferSubData`: each waits on the GPU process.
 *
 * Plus, from outside the context: time in `Game.render` and in the background
 * shader warm-up (`Game` says), `renderer.info`'s program, texture and
 * geometry counts as deltas, and any lazy part that started or settled
 * (`world/LazyPart.ts`'s watcher). Anything that happens *between* two frames
 * — a promise settling, a part landing — is put on the next frame.
 *
 * What it cannot see: GPU time (the GPU works after the calls return), the
 * draw calls themselves (not wrapped: six hundred a frame), and garbage
 * collection. A frame whose time is in `renderMs` but not in any GL bucket is
 * the draw path itself; one whose time is in `tickMs` is JavaScript.
 *
 * ## The cost, and the no-flag promise
 *
 * Nothing here is constructed without `?perf=1`, so with the flag off nothing
 * is wrapped and nothing allocated. With it, the ring is preallocated —
 * {@link FrameRecord}s rewritten in place, numbers in one `Float64Array` each
 * — and a frame allocates nothing. The wrapped calls are rare in steady play
 * (a first use, an upload); the per-frame ones (`bufferSubData` for moving
 * instances) cost two `performance.now()` and no garbage.
 */

/**
 * Every number a {@link FrameRecord} holds, by name. **The one list**:
 * reset, copy and the session totals all walk the array, so a field added
 * here is reset, copied and reported with no second place to keep in step.
 */
const NUMBERS = [
  'seq',
  'start',
  'cpu',
  'interval',
  'nextInterval',
  'draws',
  'render',
  'renderGl',
  'warmup',
  'warmupSlices',
  'programsCreated',
  'programsTotal',
  'linkRequests',
  'linkRequestMs',
  'shaderCompiles',
  'shaderCompileMs',
  'firstUses',
  'linkWait',
  'linkWaitWorst',
  'introspectCalls',
  'introspectMs',
  'completionPolls',
  'completionPollMs',
  'textureUploads',
  'textureBytes',
  'textureMs',
  'textureWorst',
  'texturesDelta',
  'geometriesDelta',
  'bufferUploads',
  'bufferBytes',
  'bufferMs',
  'syncQueries',
  'syncQueryMs',
  'gl',
  'lazyEvents',
] as const;
type NumberField = (typeof NUMBERS)[number];
const N = Object.fromEntries(NUMBERS.map((name, i) => [name, i])) as Record<NumberField, number>;

/** Summed into the session totals; the rest are per-frame facts or maxima. */
const SUMMED: readonly NumberField[] = [
  'warmup',
  'warmupSlices',
  'linkRequests',
  'linkRequestMs',
  'shaderCompiles',
  'shaderCompileMs',
  'firstUses',
  'linkWait',
  'introspectCalls',
  'introspectMs',
  'completionPolls',
  'completionPollMs',
  'textureUploads',
  'textureBytes',
  'textureMs',
  'bufferUploads',
  'bufferBytes',
  'bufferMs',
  'syncQueries',
  'syncQueryMs',
  'gl',
  'lazyEvents',
];
const MAXED: readonly NumberField[] = ['linkWaitWorst', 'textureWorst', 'cpu', 'interval'];
/** {@link SUMMED} and {@link MAXED} as indices, walked by index every frame: no iterator. */
const SUMMED_AT = Int32Array.from(SUMMED, (field) => N[field]);
const MAXED_AT = Int32Array.from(MAXED, (field) => N[field]);

/** How many names a frame keeps — of its slowest first uses, of its lazy-part events. */
const NAMES_KEPT = 4;
/** The `slowestFrames` list's length. */
export const SLOWEST_KEPT = 8;

const COMPLETION_STATUS_KHR = 0x91b1;
const ACTIVE_UNIFORMS = 0x8b86;
const ACTIVE_ATTRIBUTES = 0x8b89;

/** One frame, attributed. Preallocated and rewritten in place; never replaced. */
class FrameRecord {
  readonly v = new Float64Array(NUMBERS.length);
  valid = false;
  space = '';
  held = false;
  /** The slowest first uses this frame: three.js's program type and material name. */
  readonly programTypes: string[] = new Array<string>(NAMES_KEPT).fill('');
  readonly programNames: string[] = new Array<string>(NAMES_KEPT).fill('');
  readonly programMs = new Float64Array(NAMES_KEPT);
  programsNamed = 0;
  readonly lazyNames: string[] = new Array<string>(NAMES_KEPT).fill('');
  readonly lazyKinds: string[] = new Array<string>(NAMES_KEPT).fill('');

  reset(): void {
    this.v.fill(0);
    this.valid = false;
    this.space = '';
    this.held = false;
    this.programsNamed = 0;
  }

  copyFrom(other: FrameRecord): void {
    this.v.set(other.v);
    this.valid = other.valid;
    this.space = other.space;
    this.held = other.held;
    this.programsNamed = other.programsNamed;
    this.programMs.set(other.programMs);
    for (let i = 0; i < NAMES_KEPT; i++) {
      this.programTypes[i] = other.programTypes[i] ?? '';
      this.programNames[i] = other.programNames[i] ?? '';
      this.lazyNames[i] = other.lazyNames[i] ?? '';
      this.lazyKinds[i] = other.lazyKinds[i] ?? '';
    }
  }

  /** The program a first use waited on, kept if it is among this frame's slowest. */
  noteProgram(type: string, name: string, ms: number): void {
    let slot = this.programsNamed;
    if (slot >= NAMES_KEPT) {
      slot = 0;
      for (let i = 1; i < NAMES_KEPT; i++) if (this.programMs[i]! < this.programMs[slot]!) slot = i;
      if (this.programMs[slot]! >= ms) return;
    } else {
      this.programsNamed += 1;
    }
    this.programTypes[slot] = type;
    this.programNames[slot] = name;
    this.programMs[slot] = ms;
  }

  noteLazy(name: string, kind: string): void {
    const i = this.v[N.lazyEvents]!;
    this.v[N.lazyEvents] = i + 1;
    if (i >= NAMES_KEPT) return;
    this.lazyNames[i] = name;
    this.lazyKinds[i] = kind;
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The JSON for one frame. Allocates — called only when the report is copied. */
function describeFrame(rec: FrameRecord): Record<string, unknown> {
  const v = rec.v;
  const get = (field: NumberField): number => v[N[field]] ?? 0;
  const cpu = get('cpu');
  const render = get('render');
  const warmup = get('warmup');
  const nextInterval = get('nextInterval');
  const programs: string[] = [];
  const order = [...Array(rec.programsNamed).keys()].sort((a, b) => (rec.programMs[b] ?? 0) - (rec.programMs[a] ?? 0));
  for (const i of order) {
    const name = rec.programNames[i] ? ` "${rec.programNames[i]}"` : '';
    programs.push(`${rec.programTypes[i] || '?'}${name} ${round1(rec.programMs[i] ?? 0)} ms`);
  }
  const lazy: string[] = [];
  for (let i = 0; i < Math.min(NAMES_KEPT, get('lazyEvents')); i++) lazy.push(`${rec.lazyNames[i]} ${rec.lazyKinds[i]}`);
  if (get('lazyEvents') > NAMES_KEPT) lazy.push(`…${get('lazyEvents') - NAMES_KEPT} more`);
  return {
    frame: get('seq'),
    atS: Math.round(get('start')) / 1000,
    cpuMs: round1(cpu),
    intervalMs: round1(get('interval')),
    nextIntervalMs: nextInterval > 0 ? round1(nextInterval) : null,
    tickMs: round1(cpu - render - warmup),
    renderMs: round1(render),
    renderInGlCallsMs: round1(get('renderGl')),
    renderElseMs: round1(render - get('renderGl')),
    backgroundWarmupMs: round1(warmup),
    backgroundWarmupSlices: get('warmupSlices'),
    space: rec.space,
    held: rec.held,
    draws: get('draws'),
    programsCreated: get('programsCreated'),
    programsTotal: get('programsTotal'),
    firstUseLinkWaits: get('firstUses'),
    linkWaitMs: round1(get('linkWait')),
    linkWaitWorstMs: round1(get('linkWaitWorst')),
    slowestFirstUses: programs,
    introspectCalls: get('introspectCalls'),
    introspectMs: round1(get('introspectMs')),
    linkRequests: get('linkRequests'),
    linkRequestMs: round1(get('linkRequestMs')),
    shaderCompiles: get('shaderCompiles'),
    shaderCompileMs: round1(get('shaderCompileMs')),
    completionPolls: get('completionPolls'),
    completionPollMs: round1(get('completionPollMs')),
    texturesUploaded: get('textureUploads'),
    textureKB: Math.round(get('textureBytes') / 1024),
    textureMs: round1(get('textureMs')),
    textureWorstMs: round1(get('textureWorst')),
    texturesDelta: get('texturesDelta'),
    geometriesDelta: get('geometriesDelta'),
    bufferUploads: get('bufferUploads'),
    bufferKB: Math.round(get('bufferBytes') / 1024),
    bufferMs: round1(get('bufferMs')),
    syncQueries: get('syncQueries'),
    syncQueryMs: round1(get('syncQueryMs')),
    glCallsMs: round1(get('gl')),
    lazyParts: lazy,
  };
}

/** three.js's own program record, as `renderer.info.programs` lists them. */
interface ThreeProgram {
  readonly program?: unknown;
  readonly type?: string;
  readonly name?: string;
}

type Fn = (...args: never[]) => unknown;

export class FrameAttribution {
  private readonly renderer: WebGLRenderer;
  private readonly ring: FrameRecord[];
  /** The slowest frames since the probe started (or was reset), outliving the ring. */
  private readonly kept: FrameRecord[] = Array.from({ length: SLOWEST_KEPT }, () => new FrameRecord());
  private readonly totals = new Float64Array(NUMBERS.length);
  private head = 0;
  private current: FrameRecord;
  private seq = 0;
  private previous: FrameRecord | null = null;
  private previousKept: FrameRecord | null = null;
  private lastPrograms: number;
  private lastTextures: number;
  private lastGeometries: number;
  /** Status-query time since the last first use closed — the wait of the program about to be named. */
  private pendingWait = 0;
  private renderGlAtStart = 0;
  private renderStartedAt = -1;
  /** `KHR_parallel_shader_compile` offered, asked once. */
  private parallelCompile: boolean | null = null;

  constructor(renderer: WebGLRenderer, capacity: number) {
    this.renderer = renderer;
    this.ring = Array.from({ length: capacity }, () => new FrameRecord());
    this.current = this.ring[0]!;
    this.lastPrograms = this.programCount();
    this.lastTextures = renderer.info.memory.textures;
    this.lastGeometries = renderer.info.memory.geometries;
    this.tap(renderer.getContext());
  }

  // --- told by Game ---------------------------------------------------------

  /** `Game.render` is starting. */
  renderBegin(): void {
    this.renderStartedAt = performance.now();
    this.renderGlAtStart = this.current.v[N.gl]!;
  }

  /** `Game.render` is done. */
  renderEnd(): void {
    if (this.renderStartedAt < 0) return;
    const v = this.current.v;
    v[N.render] = v[N.render]! + (performance.now() - this.renderStartedAt);
    v[N.renderGl] = v[N.renderGl]! + (v[N.gl]! - this.renderGlAtStart);
    this.renderStartedAt = -1;
  }

  /** The background shader warm-up took `ms` and compiled `slices` this frame. */
  noteWarmup(ms: number, slices: number): void {
    const v = this.current.v;
    v[N.warmup] = v[N.warmup]! + ms;
    v[N.warmupSlices] = v[N.warmupSlices]! + slices;
  }

  /** A lazy part started or settled (`world/LazyPart.ts`'s watcher). */
  noteLazyPart(name: string, kind: string): void {
    this.current.noteLazy(name, kind);
  }

  // --- told by PerfProbe ----------------------------------------------------

  /** The frame is over: stamp it, keep it if it is among the slowest, and start the next. */
  endFrame(start: number, interval: number, cpu: number, draws: number, space: string, held: boolean): void {
    const rec = this.current;
    const v = rec.v;
    this.seq += 1;
    v[N.seq] = this.seq;
    v[N.start] = start;
    v[N.interval] = interval;
    v[N.cpu] = cpu;
    v[N.draws] = draws;
    const programs = this.programCount();
    v[N.programsCreated] = programs - this.lastPrograms;
    v[N.programsTotal] = programs;
    this.lastPrograms = programs;
    const memory = this.renderer.info.memory;
    v[N.texturesDelta] = memory.textures - this.lastTextures;
    v[N.geometriesDelta] = memory.geometries - this.lastGeometries;
    this.lastTextures = memory.textures;
    this.lastGeometries = memory.geometries;
    rec.space = space;
    rec.held = held;
    rec.valid = true;

    // What came after the frame before: how long until this one started.
    if (this.previous) this.previous.v[N.nextInterval] = interval;
    if (this.previousKept) this.previousKept.v[N.nextInterval] = interval;
    this.previousKept = null;
    this.previous = rec;

    const totals = this.totals;
    for (let i = 0; i < SUMMED_AT.length; i++) {
      const at = SUMMED_AT[i]!;
      totals[at] = totals[at]! + v[at]!;
    }
    for (let i = 0; i < MAXED_AT.length; i++) {
      const at = MAXED_AT[i]!;
      if (v[at]! > totals[at]!) totals[at] = v[at]!;
    }
    totals[N.seq] = totals[N.seq]! + 1;

    // The kept frame to give way: an empty slot, else the quickest kept.
    let give = 0;
    for (let i = 1; i < this.kept.length; i++) {
      const candidate = this.kept[i]!;
      const chosen = this.kept[give]!;
      if (!candidate.valid || (chosen.valid && candidate.v[N.cpu]! < chosen.v[N.cpu]!)) give = i;
    }
    const victim = this.kept[give]!;
    if (!victim.valid || victim.v[N.cpu]! < cpu) {
      victim.copyFrom(rec);
      this.previousKept = victim;
    }

    this.head = (this.head + 1) % this.ring.length;
    this.current = this.ring[this.head]!;
    this.current.reset();
  }

  /** Forget every frame — `__perf.reset()`. */
  reset(): void {
    for (const rec of this.ring) rec.reset();
    for (const rec of this.kept) rec.reset();
    this.totals.fill(0);
    this.previous = null;
    this.previousKept = null;
  }

  // --- read by the report ---------------------------------------------------

  /** The `n` longest-CPU frames still in the ring, longest first. */
  slowest(n = SLOWEST_KEPT): Record<string, unknown>[] {
    return this.ring
      .filter((rec) => rec.valid)
      .sort((a, b) => b.v[N.cpu]! - a.v[N.cpu]!)
      .slice(0, n)
      .map(describeFrame);
  }

  /** The longest-CPU frames since the probe started or was last reset — they outlive the ring. */
  slowestSinceStart(): Record<string, unknown>[] {
    return this.kept
      .filter((rec) => rec.valid)
      .sort((a, b) => b.v[N.cpu]! - a.v[N.cpu]!)
      .map(describeFrame);
  }

  /** Once per session: the context's facts and everything counted so far. */
  session(): Record<string, unknown> {
    const gl = this.renderer.getContext();
    if (this.parallelCompile === null) {
      // `getSupportedExtensions`, not `getExtension`: asking for an extension
      // enables it, and this report must not change what it measures.
      this.parallelCompile = (gl.getSupportedExtensions() ?? []).includes('KHR_parallel_shader_compile');
    }
    const t = this.totals;
    const get = (field: NumberField): number => t[N[field]] ?? 0;
    return {
      parallelShaderCompile: this.parallelCompile,
      checkShaderErrors: this.renderer.debug.checkShaderErrors,
      programsTotal: this.programCount(),
      texturesTotal: this.renderer.info.memory.textures,
      geometriesTotal: this.renderer.info.memory.geometries,
      framesCounted: get('seq'),
      worstCpuMs: round1(get('cpu')),
      firstUseLinkWaits: get('firstUses'),
      linkWaitMs: round1(get('linkWait')),
      linkWaitWorstMs: round1(get('linkWaitWorst')),
      introspectCalls: get('introspectCalls'),
      introspectMs: round1(get('introspectMs')),
      linkRequests: get('linkRequests'),
      linkRequestMs: round1(get('linkRequestMs')),
      shaderCompiles: get('shaderCompiles'),
      shaderCompileMs: round1(get('shaderCompileMs')),
      completionPolls: get('completionPolls'),
      completionPollMs: round1(get('completionPollMs')),
      texturesUploaded: get('textureUploads'),
      textureMB: round1(get('textureBytes') / 1048576),
      textureMs: round1(get('textureMs')),
      textureWorstMs: round1(get('textureWorst')),
      bufferUploads: get('bufferUploads'),
      bufferMB: round1(get('bufferBytes') / 1048576),
      bufferMs: round1(get('bufferMs')),
      syncQueries: get('syncQueries'),
      syncQueryMs: round1(get('syncQueryMs')),
      backgroundWarmupMs: round1(get('warmup')),
      backgroundWarmupSlices: get('warmupSlices'),
      lazyPartEvents: get('lazyEvents'),
    };
  }

  // --- the context, wrapped ---------------------------------------------------

  private programCount(): number {
    return (this.renderer.info.programs as readonly unknown[] | null | undefined)?.length ?? 0;
  }

  private add(time: NumberField, count: NumberField | null, ms: number): void {
    const v = this.current.v;
    v[N[time]] = v[N[time]]! + ms;
    if (count) v[N[count]] = v[N[count]]! + 1;
    v[N.gl] = v[N.gl]! + ms;
  }

  /** A status query about a program — part of the wait of the first use it belongs to. */
  private noteStatus(ms: number): void {
    this.pendingWait += ms;
    this.add('linkWait', null, ms);
  }

  /** `ACTIVE_UNIFORMS`: the one question every first use asks. Closes that program's wait. */
  private noteFirstUse(program: unknown, ms: number): void {
    this.add('linkWait', 'firstUses', ms);
    const wait = this.pendingWait + ms;
    this.pendingWait = 0;
    const v = this.current.v;
    if (wait > v[N.linkWaitWorst]!) v[N.linkWaitWorst] = wait;
    const programs = this.renderer.info.programs as readonly ThreeProgram[] | null | undefined;
    let type = '?';
    let name = '';
    if (programs) {
      for (const p of programs) {
        if (p.program !== program) continue;
        type = p.type ?? '?';
        name = p.name ?? '';
        break;
      }
    }
    this.current.noteProgram(type, name, wait);
  }

  private noteTexture(ms: number, bytes: number, upload: boolean): void {
    this.add('textureMs', upload ? 'textureUploads' : null, ms);
    const v = this.current.v;
    v[N.textureBytes] = v[N.textureBytes]! + bytes;
    if (ms > v[N.textureWorst]!) v[N.textureWorst] = ms;
  }

  private noteBuffer(ms: number, bytes: number): void {
    this.add('bufferMs', 'bufferUploads', ms);
    const v = this.current.v;
    v[N.bufferBytes] = v[N.bufferBytes]! + bytes;
  }

  /**
   * Wraps the context's methods. Each wrapper forwards `arguments` untouched —
   * no rest array, so no garbage — and times the call.
   */
  private tap(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const self = this;
    const context = gl as unknown as Record<string, Fn | undefined>;
    /** Times a call; forwards `arguments` and touches it no other way, so a JIT need not build it. */
    const timed = (name: string, after: (ms: number) => void): void => {
      const original = context[name] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== 'function') return;
      context[name] = function (this: unknown) {
        const started = performance.now();
        const result = original.apply(gl, arguments as unknown as unknown[]);
        after(performance.now() - started);
        return result;
      } as Fn;
    };
    /** Texture uploads only — a handful a session — may read `arguments` for the bytes. */
    const timedUpload = (name: string, upload: boolean): void => {
      const original = context[name] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== 'function') return;
      context[name] = function (this: unknown) {
        const started = performance.now();
        const result = original.apply(gl, arguments as unknown as unknown[]);
        self.noteTexture(performance.now() - started, upload ? textureBytes(arguments) : 0, upload);
        return result;
      } as Fn;
    };

    // The program's first use, and what a warm-up polls.
    const getProgramParameter = gl.getProgramParameter;
    gl.getProgramParameter = function (program: WebGLProgram, pname: number): unknown {
      const started = performance.now();
      const result: unknown = getProgramParameter.call(gl, program, pname);
      const ms = performance.now() - started;
      if (pname === COMPLETION_STATUS_KHR) self.add('completionPollMs', 'completionPolls', ms);
      else if (pname === ACTIVE_UNIFORMS) self.noteFirstUse(program, ms);
      else if (pname === ACTIVE_ATTRIBUTES) self.add('introspectMs', 'introspectCalls', ms);
      else self.noteStatus(ms);
      return result;
    };
    for (const name of ['getProgramInfoLog', 'getShaderInfoLog', 'getShaderParameter']) {
      timed(name, (ms) => self.noteStatus(ms));
    }
    for (const name of ['getActiveUniform', 'getUniformLocation', 'getActiveAttrib', 'getAttribLocation', 'getUniformBlockIndex']) {
      timed(name, (ms) => self.add('introspectMs', 'introspectCalls', ms));
    }
    timed('linkProgram', (ms) => self.add('linkRequestMs', 'linkRequests', ms));
    timed('compileShader', (ms) => self.add('shaderCompileMs', 'shaderCompiles', ms));

    for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D']) {
      timedUpload(name, true);
    }
    for (const name of ['texStorage2D', 'texStorage3D', 'generateMipmap']) timedUpload(name, false);

    // Per frame for moving instances, so no `arguments` handed on: the bytes
    // are read off the named parameters.
    const bufferData = gl.bufferData as unknown as (...args: unknown[]) => void;
    (gl as unknown as { bufferData: unknown }).bufferData = function (this: unknown, _target: number, data: unknown) {
      const started = performance.now();
      bufferData.apply(gl, arguments as unknown as unknown[]);
      self.noteBuffer(performance.now() - started, typeof data === 'number' ? data : byteLengthOf(data));
    };
    const bufferSubData = gl.bufferSubData as unknown as (...args: unknown[]) => void;
    (gl as unknown as { bufferSubData: unknown }).bufferSubData = function (
      this: unknown,
      _target: number,
      _offset: number,
      data: unknown,
      _srcOffset?: number,
      length?: number,
    ) {
      const started = performance.now();
      bufferSubData.apply(gl, arguments as unknown as unknown[]);
      const element = (data as { BYTES_PER_ELEMENT?: number } | null)?.BYTES_PER_ELEMENT ?? 1;
      self.noteBuffer(performance.now() - started, length ? length * element : byteLengthOf(data));
    };

    for (const name of ['getParameter', 'getError', 'checkFramebufferStatus', 'readPixels', 'finish', 'clientWaitSync', 'getBufferSubData']) {
      timed(name, (ms) => self.add('syncQueryMs', 'syncQueries', ms));
    }
  }
}

function byteLengthOf(data: unknown): number {
  const length = (data as { byteLength?: unknown } | null)?.byteLength;
  return typeof length === 'number' ? length : 0;
}

/**
 * An upload's bytes, estimated from its source: a typed array's own length,
 * or an image-like source's pixels as RGBA8. Reads `arguments`, which is fine
 * here: uploads are a handful a session, not a per-frame call.
 */
function textureBytes(args: IArguments): number {
  for (let i = args.length - 1; i >= 0; i--) {
    const source: unknown = args[i];
    if (typeof source !== 'object' || source === null) continue;
    if (ArrayBuffer.isView(source)) return source.byteLength;
    const s = source as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
    const w = s.naturalWidth || s.videoWidth || s.width || 0;
    const h = s.naturalHeight || s.videoHeight || s.height || 0;
    return w * h * 4;
  }
  return 0;
}
