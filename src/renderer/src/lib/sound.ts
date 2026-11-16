// Soft UI sounds synthesized with the Web Audio API (no audio files: offline and CSP-safe).
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

interface Note {
  /** Start frequency in Hz. */
  f: number
  /** Optional end frequency (exponential glide). */
  to?: number
  /** Start offset in seconds. */
  at: number
  /** Total length in seconds (attack 6ms, then exponential decay to silence). */
  dur: number
  /** Peak gain 0..1 before master gain. */
  g: number
  type?: 'sine' | 'triangle'
}

const MASTER = 0.2
const LOWPASS_HZ = 2600

/** Sound recipes. All sine/triangle with a quick attack and exponential decay. */
export const RECIPES: Record<SoundName, Note[]> = {
  reveal: [{ f: 1100, to: 900, at: 0, dur: 0.05, g: 0.5, type: 'triangle' }],
  again: [{ f: 150, to: 95, at: 0, dur: 0.16, g: 0.9, type: 'sine' }],
  hard: [{ f: 260, to: 230, at: 0, dur: 0.14, g: 0.6, type: 'sine' }],
  good: [{ f: 520, to: 700, at: 0, dur: 0.1, g: 0.6, type: 'sine' }],
  easy: [
    { f: 659, at: 0, dur: 0.14, g: 0.5, type: 'sine' },
    { f: 988, at: 0.07, dur: 0.18, g: 0.5, type: 'sine' }
  ],
  undo: [{ f: 640, to: 400, at: 0, dur: 0.1, g: 0.5, type: 'sine' }],
  complete: [
    { f: 523, at: 0, dur: 0.3, g: 0.5, type: 'sine' },
    { f: 659, at: 0.12, dur: 0.3, g: 0.5, type: 'sine' },
    { f: 784, at: 0.24, dur: 0.5, g: 0.5, type: 'sine' }
  ],
  added: [{ f: 440, to: 620, at: 0, dur: 0.09, g: 0.55, type: 'sine' }],
  toggle: [{ f: 900, to: 800, at: 0, dur: 0.025, g: 0.35, type: 'triangle' }],
  success: [
    { f: 784, at: 0, dur: 0.12, g: 0.35, type: 'sine' },
    { f: 1047, at: 0.06, dur: 0.16, g: 0.3, type: 'sine' }
  ],
  error: [
    { f: 220, at: 0, dur: 0.06, g: 0.5, type: 'sine' },
    { f: 196, at: 0.09, dur: 0.07, g: 0.5, type: 'sine' }
  ],
  import: [
    { f: 587, at: 0, dur: 0.18, g: 0.45, type: 'sine' },
    { f: 880, at: 0.09, dur: 0.22, g: 0.45, type: 'sine' }
  ],
  preview: [{ f: 520, to: 700, at: 0, dur: 0.1, g: 0.6, type: 'sine' }]
}

/** Total length of a recipe in seconds. */
export function recipeLength(name: SoundName): number {
  return Math.max(...RECIPES[name].map((n) => n.at + n.dur))
}

/** Schedule a sound on any (online or offline) context. `volume` is 0..1. */
export function renderSound(ctx: BaseAudioContext, name: SoundName, volume: number, t0 = 0): void {
  const out = ctx.createGain()
  out.gain.value = MASTER * Math.max(0, Math.min(1, volume))
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = LOWPASS_HZ
  lp.Q.value = 0.5
  lp.connect(out)
  out.connect(ctx.destination)
  for (const n of RECIPES[name]) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    const start = t0 + n.at
    osc.type = n.type ?? 'sine'
    osc.frequency.setValueAtTime(n.f, start)
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.dur)
    g.gain.setValueAtTime(0.0001, start)
    g.gain.linearRampToValueAtTime(n.g, start + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
    osc.connect(g)
    g.connect(lp)
    osc.start(start)
    osc.stop(start + n.dur + 0.02)
  }
}

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (ctx) return ctx
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/** Play a short UI sound. No-ops when sounds are off, the volume is 0 or the window is hidden. */
export function playSound(name: SoundName): void {
  try {
    if (typeof document === 'undefined' || document.hidden) return
    const { soundEffects, soundVolume } = useApp.getState().prefs
    if (!soundEffects || soundVolume <= 0) return
    const c = getContext()
    if (!c) return
    if (c.state === 'suspended') void c.resume().catch(() => undefined)
    renderSound(c, name, soundVolume)
  } catch {
    /* audio is optional */
  }
}
