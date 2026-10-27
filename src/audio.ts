/** Tiny Web Audio synth — no external sound files needed. */

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    ctx = new Ctx()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function unlockAudio() {
  ac()
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.08,
  slideTo?: number,
) {
  const audio = ac()
  if (!audio) return
  const t0 = audio.currentTime
  const osc = audio.createOscillator()
  const g = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur)
  }
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(audio.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export const sfx = {
  flap() {
    tone(520, 0.09, 'square', 0.045, 280)
  },
  pipe() {
    tone(660, 0.1, 'triangle', 0.06)
    setTimeout(() => tone(880, 0.12, 'triangle', 0.05), 55)
  },
  honey() {
    tone(740, 0.08, 'sine', 0.07)
    setTimeout(() => tone(980, 0.12, 'sine', 0.06), 60)
  },
  flower() {
    tone(620, 0.07, 'triangle', 0.055)
    setTimeout(() => tone(780, 0.1, 'triangle', 0.05), 50)
  },
  die() {
    tone(220, 0.28, 'sawtooth', 0.05, 70)
  },
  start() {
    tone(392, 0.1, 'triangle', 0.06)
    setTimeout(() => tone(523, 0.12, 'triangle', 0.055), 90)
    setTimeout(() => tone(659, 0.16, 'triangle', 0.05), 180)
  },
}
