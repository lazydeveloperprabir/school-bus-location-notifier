type AlarmState = {
  arrivedPlayed: boolean
  enRoutePlayed: boolean
  lastApproachAnnounceAt: number
}

let audioCtx: AudioContext | null = null
let state: AlarmState = {
  arrivedPlayed: false,
  enRoutePlayed: false,
  lastApproachAnnounceAt: 0,
}

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume()
  }
  return audioCtx
}

/** Unlock audio on a user gesture (required on mobile) */
export async function unlockAudio(): Promise<void> {
  const ctx = getCtx()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
  const buffer = ctx.createBuffer(1, 1, 22050)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start(0)
}

export function resetAlarms(): void {
  state = {
    arrivedPlayed: false,
    enRoutePlayed: false,
    lastApproachAnnounceAt: 0,
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

function beep(
  frequency: number,
  durationMs: number,
  startAt: number,
  type: OscillatorType = 'sine',
  gainValue = 0.25,
): void {
  const ctx = getCtx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    startAt + durationMs / 1000,
  )
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + durationMs / 1000 + 0.05)
}

function formatSpokenDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000
    const rounded = Math.round(km * 10) / 10
    return `${rounded} kilometer${rounded === 1 ? '' : 's'}`
  }
  const m = Math.max(0, Math.round(meters))
  return `${m} meter${m === 1 ? '' : 's'}`
}

/**
 * One-time status when the app opens and the bus is still outside the approach zone.
 */
export function playEnRouteStatusOnce(options: {
  remainingDistanceM: number
  approachDistanceM: number
}): void {
  if (state.arrivedPlayed || state.enRoutePlayed) return
  state.enRoutePlayed = true

  const ctx = getCtx()
  const t = ctx.currentTime
  beep(660, 160, t, 'sine', 0.18)

  speak(
    `Tracking started. School bus is about ${formatSpokenDistance(options.remainingDistanceM)} away by road. You will hear alerts when it is within ${formatSpokenDistance(options.approachDistanceM)}.`,
  )
}

/** Announce when the bus reaches a user-selected route alarm point (once per point) */
export function playWaypointAlarm(options: {
  label: string
  remainingDistanceM: number
}): void {
  if (state.arrivedPlayed) return

  const ctx = getCtx()
  const t = ctx.currentTime
  beep(740, 160, t, 'triangle', 0.22)
  beep(988, 200, t + 0.2, 'triangle', 0.2)

  speak(
    `Alarm point ${options.label}. School bus is about ${formatSpokenDistance(options.remainingDistanceM)} away.`,
  )
}

/**
 * Continuous approach announcements while inside the approach distance.
 */
export function playApproachingUpdate(options: {
  remainingDistanceM: number
  announceIntervalSec: number
  force?: boolean
}): void {
  if (state.arrivedPlayed) return

  const intervalMs = Math.max(1, options.announceIntervalSec) * 1000
  const now = Date.now()
  if (
    !options.force &&
    state.lastApproachAnnounceAt > 0 &&
    now - state.lastApproachAnnounceAt < intervalMs
  ) {
    return
  }
  state.lastApproachAnnounceAt = now
  // Mark en-route as handled so we don't also fire the one-shot later
  state.enRoutePlayed = true

  const ctx = getCtx()
  const t = ctx.currentTime
  beep(880, 180, t, 'square', 0.2)
  beep(1174, 160, t + 0.18, 'square', 0.16)

  speak(
    `School bus approaching. About ${formatSpokenDistance(options.remainingDistanceM)} by road.`,
  )
}

/** Softer chime + spoken arrival message (once) */
export function playArrivedAlarm(): void {
  if (state.arrivedPlayed) return
  state.arrivedPlayed = true

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }

  const ctx = getCtx()
  const now = ctx.currentTime
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((freq, i) => {
    beep(freq, 350, now + i * 0.22, 'sine', 0.28)
  })

  window.setTimeout(() => {
    speak('The school bus has arrived at your location.')
  }, 900)
}

function speak(text: string): void {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.95
  utterance.pitch = 1
  utterance.volume = 1
  window.speechSynthesis.speak(utterance)
}

export function getAlarmState(): AlarmState {
  return { ...state }
}
