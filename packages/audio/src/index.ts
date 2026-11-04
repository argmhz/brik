import {
  type App,
  type Entity,
  GlobalTransform2D,
  Transform2D,
  type World,
  defineComponent,
  t,
  withMeta,
} from "@brik/core";

export const BUSES = ["music", "sfx", "ui"] as const;
export type Bus = (typeof BUSES)[number];

/** Plays a sound clip from the entity. */
export const AudioSource = defineComponent("AudioSource", {
  /** Audio clip guid. */
  clip: withMeta(t.ref<string | null>(() => null), { editor: "audio" }),
  volume: withMeta(t.f32(1), { min: 0, max: 1, step: 0.05 }),
  pitch: withMeta(t.f32(1), { min: 0.1, max: 4, step: 0.05 }),
  loop: t.bool(false),
  playOnStart: t.bool(true),
  bus: t.enum(BUSES, "sfx"),
  /** Pan and fade the sound by its position relative to the AudioListener. */
  spatial: t.bool(false),
  /** Distance (world units) at which a spatial sound has faded out. */
  range: withMeta(t.f32(600), { min: 1, step: 10 }),
});

/** The "ears" for spatial sounds. Usually on the camera. */
export const AudioListener = defineComponent("AudioListener", {}, { requires: [Transform2D] });

export const AUDIO_EXTENSIONS: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

export class AudioClip {
  buffer: AudioBuffer | null = null;
  status: "pending" | "loading" | "ready" | "error" = "pending";
  private decoding: Promise<AudioBuffer | null> | null = null;

  constructor(
    readonly guid: string,
    public name: string,
    /** Encoded file bytes, kept until decoded. */
    public bytes: Uint8Array | null,
  ) {}

  /** Decodes the clip (once). Needs an AudioContext. */
  decode(ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    if (this.decoding) return this.decoding;
    if (!this.bytes) return Promise.resolve(null);
    this.status = "loading";
    const copy = this.bytes.slice().buffer;
    this.decoding = ctx.decodeAudioData(copy).then(
      (buf) => {
        this.buffer = buf;
        this.status = "ready";
        return buf;
      },
      (err) => {
        this.status = "error";
        console.error(`[brik] could not decode audio "${this.name}"`, err);
        return null;
      },
    );
    return this.decoding;
  }
}

export interface PlayOptions {
  volume?: number;
  pitch?: number;
  loop?: boolean;
  bus?: Bus;
  /** -1 (left) to 1 (right). */
  pan?: number;
}

/** A playing (or about to play) sound. */
export interface Sound {
  stop(): void;
  readonly playing: boolean;
  volume: number;
  pan: number;
}

class Voice implements Sound {
  playing = true;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private _volume: number;
  private _pan: number;

  constructor(
    private readonly audio: Audio,
    clip: AudioClip,
    private readonly opts: PlayOptions,
  ) {
    this._volume = opts.volume ?? 1;
    this._pan = opts.pan ?? 0;
    const ctx = audio.context;
    if (!ctx) {
      this.playing = false;
      return;
    }
    const start = (buf: AudioBuffer | null) => {
      if (!buf || !this.playing) {
        this.playing = false;
        return;
      }
      this.gain = ctx.createGain();
      this.gain.gain.value = this._volume;
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = this._pan;
      this.src = ctx.createBufferSource();
      this.src.buffer = buf;
      this.src.loop = opts.loop ?? false;
      this.src.playbackRate.value = opts.pitch ?? 1;
      this.src.connect(this.gain).connect(this.panner).connect(audio.bus(opts.bus ?? "sfx"));
      this.src.onended = () => {
        this.playing = false;
        audio.forget(this);
      };
      this.src.start();
    };
    if (clip.buffer) start(clip.buffer);
    else clip.decode(ctx).then(start);
  }

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  get pan(): number {
    return this._pan;
  }

  set pan(v: number) {
    this._pan = Math.max(-1, Math.min(1, v));
    if (this.panner) this.panner.pan.value = this._pan;
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    try {
      this.src?.stop();
    } catch {
      // already stopped
    }
    this.src?.disconnect();
    this.audio.forget(this);
  }
}

/**
 * Sound playback with music/sfx/ui buses. Available as a resource: `world.resource(Audio)`.
 * Without WebAudio (e.g. in tests) everything is silently a no-op.
 *
 * ```ts
 * audio.play("jump");
 * audio.volume.music = 0.5;
 * ```
 */
export class Audio {
  readonly clips = new Map<string, AudioClip>();
  /** Bus volumes, 0..1. `master` scales all of them. */
  readonly volume = { master: 1, music: 1, sfx: 1, ui: 1 };
  private ctx: AudioContext | null | undefined;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private voices = new Set<Voice>();
  muted = false;

  /** The WebAudio context, created on first use. Null where WebAudio is missing. */
  get context(): AudioContext | null {
    if (this.ctx === undefined) {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      this.ctx = Ctor ? new Ctor() : null;
      if (this.ctx) {
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        for (const b of BUSES) {
          const g = this.ctx.createGain();
          g.connect(this.master);
          this.buses.set(b, g);
        }
        this.unlockOnGesture();
      }
    }
    return this.ctx;
  }

  /** @internal */
  bus(name: Bus): GainNode {
    return this.buses.get(name) ?? this.master!;
  }

  /** Registers an encoded clip (wav, mp3, ogg). It is decoded the first time it plays. */
  addClip(guid: string, name: string, bytes: Uint8Array): AudioClip {
    const clip = new AudioClip(guid, name, bytes);
    this.clips.set(guid, clip);
    return clip;
  }

  removeClip(guid: string): void {
    this.clips.delete(guid);
  }

  /** Loads a clip from a URL. */
  async load(url: string, opts: { guid?: string; name?: string } = {}): Promise<AudioClip> {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const name = opts.name ?? url.split("/").pop()!.replace(/\.[^.]+$/, "");
    return this.addClip(opts.guid ?? url, name, bytes);
  }

  /** Finds a clip by guid or name. */
  clip(nameOrGuid: string): AudioClip | undefined {
    const c = this.clips.get(nameOrGuid);
    if (c) return c;
    for (const clip of this.clips.values()) if (clip.name === nameOrGuid) return clip;
    return undefined;
  }

  /** Plays a clip by guid or name. */
  play(clip: string | AudioClip, opts: PlayOptions = {}): Sound {
    const c = typeof clip === "string" ? this.clip(clip) : clip;
    if (!c) {
      console.warn(`[brik] unknown sound "${String(clip)}"`);
      return { stop() {}, playing: false, volume: 0, pan: 0 };
    }
    const v = new Voice(this, c, opts);
    if (v.playing) this.voices.add(v);
    return v;
  }

  /** Stops every sound. */
  stopAll(): void {
    for (const v of [...this.voices]) v.stop();
  }

  get playingCount(): number {
    return this.voices.size;
  }

  /** @internal */
  forget(v: Voice): void {
    this.voices.delete(v);
  }

  /** Applies bus volumes. Called every frame by the audio system. */
  updateVolumes(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.value = this.muted ? 0 : this.volume.master;
    for (const [name, g] of this.buses) g.gain.value = this.volume[name];
  }

  private unlockOnGesture(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "suspended" || typeof window === "undefined") return;
    const resume = () => {
      void ctx.resume();
      window.removeEventListener("pointerdown", resume, true);
      window.removeEventListener("keydown", resume, true);
    };
    window.addEventListener("pointerdown", resume, true);
    window.addEventListener("keydown", resume, true);
  }
}

interface SourceState {
  ref: number;
  clip: string | null;
  sound: Sound | null;
}

/** Starts AudioSources, stops them when removed, and pans spatial ones. */
export class AudioSystem {
  private sources = new Map<Entity, SourceState>();

  run(world: World): void {
    const audio = world.resource(Audio);
    audio.updateVolumes();
    const A = world.store(AudioSource);

    for (const [e, s] of this.sources) {
      if (world.ref(e) !== s.ref || !world.has(e, AudioSource)) {
        s.sound?.stop();
        this.sources.delete(e);
      }
    }

    let lx = 0;
    let ly = 0;
    const listener = world.query([AudioListener]).first();
    if (listener >= 0) [lx, ly] = position(world, listener);

    for (const e of world.query([AudioSource])) {
      let s = this.sources.get(e);
      if (!s) {
        s = { ref: world.ref(e), clip: A.clip[e], sound: null };
        this.sources.set(e, s);
        if (A.playOnStart[e] && A.clip[e]) s.sound = this.start(audio, world, e);
      } else if (s.clip !== A.clip[e]) {
        // clip swapped from a script: play the new one if the old one was playing
        const was = s.sound?.playing ?? false;
        s.sound?.stop();
        s.clip = A.clip[e];
        s.sound = was && A.clip[e] ? this.start(audio, world, e) : null;
      }
      const sound = s.sound;
      if (!sound?.playing) continue;
      let vol = A.volume[e];
      if (A.spatial[e]) {
        const [x, y] = position(world, e);
        const dx = x - lx;
        const dist = Math.hypot(dx, y - ly);
        const range = Math.max(1, A.range[e]);
        vol *= Math.max(0, 1 - dist / range);
        sound.pan = Math.max(-1, Math.min(1, dx / (range * 0.5)));
      }
      sound.volume = vol;
    }
  }

  /** Plays an entity's AudioSource now (e.g. from a script). */
  playSource(world: World, e: Entity): Sound | null {
    const s = this.sources.get(e);
    s?.sound?.stop();
    const sound = this.start(world.resource(Audio), world, e);
    this.sources.set(e, { ref: world.ref(e), clip: world.store(AudioSource).clip[e], sound });
    return sound;
  }

  stopAll(): void {
    for (const s of this.sources.values()) s.sound?.stop();
    this.sources.clear();
  }

  private start(audio: Audio, world: World, e: Entity): Sound | null {
    const A = world.store(AudioSource);
    const clip = A.clip[e];
    if (!clip) return null;
    return audio.play(clip, {
      volume: A.volume[e],
      pitch: A.pitch[e],
      loop: A.loop[e] !== 0,
      bus: A.bus[e] as Bus,
    });
  }
}

function position(world: World, e: Entity): [number, number] {
  if (world.has(e, GlobalTransform2D)) {
    const g = world.store(GlobalTransform2D).matrix;
    return [g.tx[e], g.ty[e]];
  }
  const T = world.store(Transform2D);
  return [T.position.x[e], T.position.y[e]];
}

/** WebAudio playback, AudioSource and AudioListener. */
export const AudioPlugin = {
  name: "brik:audio",
  build(app: App) {
    if (!app.world.hasResource(Audio)) app.world.insertResource(new Audio());
    const system = app.world.insertResource(new AudioSystem());
    app.addSystem("update", { name: "audio", run: (w: World) => system.run(w) });
  },
};
