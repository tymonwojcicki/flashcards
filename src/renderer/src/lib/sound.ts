// UI sounds synthesized with the Web Audio API (no audio files: offline and CSP-safe).
//
// Design: one physical palette ("soft mallet" on a small wooden/glass bar, plus a paper-like tap),
// all notes from C major pentatonic so any two sounds sit together. No pitch glides (they read as
// arcade). Each note = a few partials that decay at different rates + a tiny filtered-noise contact
// transient, through a lowpass, a short generated room reverb and a gentle compressor. Every play
// varies velocity and tuning slightly so repeats don't sound mechanical. Frequent actions are the
// quietest; rare ones (session complete) are the richest.
import { useApp } from '@renderer/store/app'

export type SoundName =
  | 'reveal'
  | 'again'
  | 'hard'
  | 'good'
  | 'easy'
  | 'undo'
  | 'complete'
  | 'added'
  | 'toggle'
  | 'success'
  | 'error'
  | 'import'
  | 'preview'
  | 'start'
  | 'themeLight'
  | 'themeDark'
  | 'accent'
  | 'nav'
  | 'delete'
  | 'select'
  | 'tick'

// Pentatonic note frequencies (Hz).
const N = {
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.5
}

type Event =
  /** Soft mallet note. `tone` 0..1 = how bright (more upper partials, higher filter). */
  | { kind: 'mallet'; f: number; at: number; vel: number; decay: number; tone?: number }
  /** Paper/glass tap: band-passed noise click with a faint pitched body. */
  | { kind: 'tap'; at: number; vel: number; center: number }

interface Recipe {
  events: Event[]
  /** Lowpass cutoff for the whole sound. */
  cutoff: number
  /** Reverb send 0..1. */
  room: number
}

const R: Record<SoundName, Recipe> = {
  // Frequent: a dry, crisp card-flip tick (tap + a very short high mallet), no room.
  // Barely-there soft paper touch: low, dull and quiet so it never draws attention.
  reveal: {
    events: [{ kind: 'tap', at: 0, vel: 0.16, center: 1500 }],
    cutoff: 2200,
    room: 0
  },
  // Session start: quick two-note "ready".
  start: {
    events: [
      { kind: 'mallet', f: N.C5, at: 0, vel: 0.5, decay: 0.25, tone: 0.55 },
      { kind: 'mallet', f: N.G5, at: 0.065, vel: 0.55, decay: 0.4, tone: 0.6 }
    ],
    cutoff: 4200,
    room: 0.12
  },
  // Theme change: a fast light shimmer, rising into light, falling into dark (matches the sweep).
  themeLight: {
    events: [
      { kind: 'mallet', f: N.G5, at: 0, vel: 0.32, decay: 0.2, tone: 0.6 },
      { kind: 'mallet', f: N.C6, at: 0.04, vel: 0.34, decay: 0.24, tone: 0.6 },
      { kind: 'mallet', f: N.E6, at: 0.08, vel: 0.36, decay: 0.4, tone: 0.65 }
    ],
    cutoff: 5200,
    room: 0.12
  },
  themeDark: {
    events: [
      { kind: 'mallet', f: N.E5, at: 0, vel: 0.36, decay: 0.2, tone: 0.45 },
      { kind: 'mallet', f: N.C5, at: 0.04, vel: 0.36, decay: 0.24, tone: 0.45 },
      { kind: 'mallet', f: N.G4, at: 0.08, vel: 0.4, decay: 0.45, tone: 0.45 }
    ],
    cutoff: 3200,
    room: 0.12
  },
  // Accent change: same shimmer family as the theme sound, a brighter, wider rise.
  accent: {
    events: [
      { kind: 'mallet', f: N.E5, at: 0, vel: 0.3, decay: 0.2, tone: 0.6 },
      { kind: 'mallet', f: N.A5, at: 0.045, vel: 0.33, decay: 0.24, tone: 0.6 },
      { kind: 'mallet', f: N.E6, at: 0.09, vel: 0.36, decay: 0.42, tone: 0.65 }
    ],
    cutoff: 5200,
    room: 0.14
  },
  // Choosing an option (segmented buttons, dropdowns, menu items): soft tap with a faint note.
  select: {
    events: [
      { kind: 'tap', at: 0, vel: 0.32, center: 2600 },
      { kind: 'mallet', f: N.G5, at: 0.004, vel: 0.14, decay: 0.08, tone: 0.3 }
    ],
    cutoff: 5000,
    room: 0
  },
  // Slider detent: very quiet, dry.
  tick: { events: [{ kind: 'tap', at: 0, vel: 0.14, center: 3600 }], cutoff: 6000, room: 0 },
  // Sidebar navigation: a light, dry tick.
  nav: { events: [{ kind: 'tap', at: 0, vel: 0.32, center: 2400 }], cutoff: 6000, room: 0 },
  // Moved to Trash: a soft low "set down".
  delete: {
    events: [
      { kind: 'tap', at: 0, vel: 0.3, center: 1400 },
      { kind: 'mallet', f: N.D4, at: 0.01, vel: 0.5, decay: 0.2, tone: 0.2 },
      { kind: 'mallet', f: N.A3, at: 0.07, vel: 0.45, decay: 0.26, tone: 0.15 }
    ],
    cutoff: 1500,
    room: 0.06
  },
  // Gentle, low, muted knock. Not a buzzer.
  again: {
    events: [{ kind: 'mallet', f: N.A3, at: 0, vel: 0.75, decay: 0.22, tone: 0.1 }],
    cutoff: 900,
    room: 0.1
  },
  hard: {
    events: [{ kind: 'mallet', f: N.D4, at: 0, vel: 0.6, decay: 0.24, tone: 0.3 }],
    cutoff: 1800,
    room: 0.12
  },
  good: {
    events: [{ kind: 'mallet', f: N.G4, at: 0, vel: 0.6, decay: 0.3, tone: 0.5 }],
    cutoff: 3200,
    room: 0.14
  },
  easy: {
    events: [
      { kind: 'mallet', f: N.G4, at: 0, vel: 0.5, decay: 0.28, tone: 0.5 },
      { kind: 'mallet', f: N.C5, at: 0.075, vel: 0.55, decay: 0.42, tone: 0.6 }
    ],
    cutoff: 3600,
    room: 0.18
  },
  undo: {
    events: [
      { kind: 'tap', at: 0, vel: 0.35, center: 2000 },
      { kind: 'mallet', f: N.E4, at: 0.02, vel: 0.4, decay: 0.2, tone: 0.3 }
    ],
    cutoff: 2400,
    room: 0.1
  },
  complete: {
    events: [
      { kind: 'mallet', f: N.C5, at: 0, vel: 0.45, decay: 0.6, tone: 0.55 },
      { kind: 'mallet', f: N.E5, at: 0.11, vel: 0.45, decay: 0.6, tone: 0.55 },
      { kind: 'mallet', f: N.G5, at: 0.22, vel: 0.45, decay: 0.7, tone: 0.55 },
      { kind: 'mallet', f: N.C6, at: 0.36, vel: 0.5, decay: 1.1, tone: 0.65 }
    ],
    cutoff: 4200,
    room: 0.28
  },
  added: {
    events: [
      { kind: 'tap', at: 0, vel: 0.3, center: 3000 },
      { kind: 'mallet', f: N.C5, at: 0.01, vel: 0.5, decay: 0.3, tone: 0.55 }
    ],
    cutoff: 3600,
    room: 0.14
  },
  toggle: { events: [{ kind: 'tap', at: 0, vel: 0.45, center: 3400 }], cutoff: 7000, room: 0 },
  success: {
    events: [
      { kind: 'mallet', f: N.E5, at: 0, vel: 0.35, decay: 0.3, tone: 0.6 },
      { kind: 'mallet', f: N.A5, at: 0.07, vel: 0.38, decay: 0.45, tone: 0.6 }
    ],
    cutoff: 4200,
    room: 0.2
  },
  error: {
    events: [
      { kind: 'mallet', f: N.E4, at: 0, vel: 0.5, decay: 0.16, tone: 0.15 },
      { kind: 'mallet', f: N.C4, at: 0.1, vel: 0.5, decay: 0.22, tone: 0.15 }
    ],
    cutoff: 1100,
    room: 0.1
  },
  import: {
    events: [
      { kind: 'mallet', f: N.E5, at: 0, vel: 0.42, decay: 0.45, tone: 0.55 },
      { kind: 'mallet', f: N.G5, at: 0.09, vel: 0.42, decay: 0.5, tone: 0.55 },
      { kind: 'mallet', f: N.C6, at: 0.19, vel: 0.46, decay: 0.85, tone: 0.6 }
    ],
    cutoff: 4200,
    room: 0.24
  },
  preview: {
    events: [{ kind: 'mallet', f: N.G4, at: 0, vel: 0.6, decay: 0.3, tone: 0.5 }],
    cutoff: 3200,
    room: 0.14
  }
}

const MASTER = 0.85

// ---- per-context shared resources (noise buffer, room impulse, output bus) ----

interface Bus {
  noise: AudioBuffer
  impulse: AudioBuffer
}
const buses = new WeakMap<BaseAudioContext, Bus>()

function bus(ctx: BaseAudioContext): Bus {
  let b = buses.get(ctx)
  if (b) return b
  const sr = ctx.sampleRate
  const noise = ctx.createBuffer(1, Math.floor(sr * 0.25), sr)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  // Small, dark room: ~0.9s exponentially decaying stereo noise, high end rolled off over time.
  const len = Math.floor(sr * 0.9)
  const impulse = ctx.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const k = 0.35 + 0.6 * t // darker as it decays
      lp = lp + (1 - k) * ((Math.random() * 2 - 1) - lp)
      d[i] = lp * Math.pow(1 - t, 3.2)
    }
  }
  b = { noise, impulse }
  buses.set(ctx, b)
  return b
}

const jitter = (amount: number): number => 1 + (Math.random() * 2 - 1) * amount

function env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

function mallet(ctx: BaseAudioContext, out: AudioNode, t: number, e: Extract<Event, { kind: 'mallet' }>): void {
  const tone = e.tone ?? 0.5
  const f = e.f * jitter(0.004) // ~ +/- 7 cents
  const vel = e.vel * jitter(0.04)
  // Partials of a struck bar: fundamental, octave and a soft inharmonic upper partial that dies fast.
  const partials: [number, number, number][] = [
    [1, 1, e.decay],
    [2.0, 0.22 * tone, e.decay * 0.45],
    [3.93, 0.1 * tone, e.decay * 0.18],
    [0.5, 0.12, e.decay * 0.6] // a little sub warmth
  ]
  const stopAt = t + e.decay + 0.05
  for (const [ratio, rel, dec] of partials) {
    if (rel <= 0.001) continue
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = f * ratio
    const g = ctx.createGain()
    env(g, t, vel * rel, 0.004, dec)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(stopAt)
  }
  // Contact transient: very short band-passed noise, like a felt mallet touching wood.
  const n = ctx.createBufferSource()
  n.buffer = bus(ctx).noise
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = Math.min(6000, f * 4)
  bp.Q.value = 1.2
  const ng = ctx.createGain()
  env(ng, t, vel * 0.12 * (0.5 + tone), 0.001, 0.018)
  n.connect(bp).connect(ng).connect(out)
  n.start(t)
  n.stop(t + 0.05)
}

function tap(ctx: BaseAudioContext, out: AudioNode, t: number, e: Extract<Event, { kind: 'tap' }>): void {
  const vel = e.vel * jitter(0.06)
  const center = e.center * jitter(0.03)
  const n = ctx.createBufferSource()
  n.buffer = bus(ctx).noise
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = center
  bp.Q.value = 1.6
  const g = ctx.createGain()
  env(g, t, vel * 1.3, 0.001, 0.034)
  n.connect(bp).connect(g).connect(out)
  n.start(t)
  n.stop(t + 0.06)
  // Faint pitched body so it reads as a material, not static.
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.value = center / 2
  const og = ctx.createGain()
  env(og, t, vel * 0.18, 0.002, 0.04)
  o.connect(og).connect(out)
  o.start(t)
  o.stop(t + 0.06)
}

/** Schedule a sound on any (online or offline) context at time `t0`. `volume` is 0..1. */
export function renderSound(ctx: BaseAudioContext, name: SoundName, volume: number, t0 = 0): void {
  const r = R[name]
  const master = ctx.createGain()
  master.gain.value = MASTER * Math.max(0, Math.min(1, volume))
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.knee.value = 12
  comp.ratio.value = 3
  comp.attack.value = 0.003
  comp.release.value = 0.15
  comp.connect(master).connect(ctx.destination)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = r.cutoff
  lp.Q.value = 0.4
  const dry = ctx.createGain()
  dry.gain.value = 1 - r.room * 0.5
  const wet = ctx.createGain()
  wet.gain.value = r.room
  const verb = ctx.createConvolver()
  verb.buffer = bus(ctx).impulse
  lp.connect(dry).connect(comp)
  if (r.room > 0) lp.connect(verb).connect(wet).connect(comp)

  for (const e of r.events) {
    if (e.kind === 'mallet') mallet(ctx, lp, t0 + e.at, e)
    else tap(ctx, lp, t0 + e.at, e)
  }
}

/** Approximate audible length of a sound in seconds (including the room tail). */
export function soundLength(name: SoundName): number {
  const r = R[name]
  return Math.max(...r.events.map((e) => e.at + (e.kind === 'mallet' ? e.decay : 0.03))) + (r.room > 0 ? 0.6 : 0)
}

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (ctx) return ctx
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor({ latencyHint: 'interactive' })
  } catch {
    return null
  }
  return ctx
}

/** Play a UI sound. No-ops when sounds are off, the volume is 0 or the window is hidden. */
export function playSound(name: SoundName): void {
  try {
    if (typeof document === 'undefined' || document.hidden) return
    const { soundEffects, soundVolume } = useApp.getState().prefs
    if (!soundEffects || soundVolume <= 0) return
    const c = getContext()
    if (!c) return
    // Schedule on the running context clock; if suspended (autoplay policy), resume first.
    const play = (): void => renderSound(c, name, soundVolume, c.currentTime + 0.005)
    if (c.state === 'suspended') void c.resume().then(play, () => undefined)
    else play()
  } catch {
    /* audio is optional */
  }
}
