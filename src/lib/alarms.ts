type AlarmState = {
  arrivedPlayed: boolean
  enRoutePlayed: boolean
  lastApproachAnnounceAt: number
  muted: boolean
  trackingActive: boolean
}

type MuteListener = (muted: boolean) => void

let audioCtx: AudioContext | null = null
let keepaliveAudio: HTMLAudioElement | null = null
let keepaliveUrl: string | null = null
let listenersAttached = false
let muteListeners = new Set<MuteListener>()

let state: AlarmState = {
  arrivedPlayed: false,
  enRoutePlayed: false,
  lastApproachAnnounceAt: 0,
  muted: false,
  trackingActive: false,
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

function notifyMuteListeners() {
  for (const listener of muteListeners) listener(state.muted)
}

export function subscribeMute(listener: MuteListener): () => void {
  muteListeners.add(listener)
  listener(state.muted)
  return () => {
    muteListeners.delete(listener)
  }
}

export function isMuted(): boolean {
  return state.muted
}

export function isTrackingAudioActive(): boolean {
  return state.trackingActive
}

/** Build a short near-silent WAV so mobile browsers keep the page in a media session. */
function createKeepaliveWavUrl(): string {
  const sampleRate = 8000
  const seconds = 2
  const numSamples = sampleRate * seconds
  const dataSize = numSamples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset: number, value: string) {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // Quiet tone (~inaudible) — pure digital silence is often ignored by OS audio policies
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const sample = Math.sin(2 * Math.PI * 18 * t) * 80
    view.setInt16(44 + i * 2, sample, true)
  }

  const blob = new Blob([buffer], { type: 'audio/wav' })
  return URL.createObjectURL(blob)
}

async function ensureKeepalivePlaying(): Promise<void> {
  if (state.muted || !state.trackingActive || state.arrivedPlayed) return

  if (!keepaliveAudio) {
    keepaliveUrl = createKeepaliveWavUrl()
    keepaliveAudio = new Audio(keepaliveUrl)
    keepaliveAudio.loop = true
    keepaliveAudio.preload = 'auto'
    keepaliveAudio.volume = 0.05
    keepaliveAudio.setAttribute('playsinline', 'true')
  }

  try {
    await keepaliveAudio.play()
  } catch {
    // Autoplay may fail until a gesture; unlockAudio/startTrackingAudio handles that.
  }

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Tracking school bus',
        artist: 'School Bus Notifier',
        album: 'Live alerts',
      })
      navigator.mediaSession.playbackState = 'playing'
      navigator.mediaSession.setActionHandler('pause', () => {
        setMuted(true)
      })
      navigator.mediaSession.setActionHandler('play', () => {
        setMuted(false)
      })
      navigator.mediaSession.setActionHandler('stop', () => {
        stopTrackingAudio({ reason: 'user' })
      })
    } catch {
      // Media Session handlers are best-effort
    }
  }
}

function stopKeepalive() {
  if (keepaliveAudio) {
    keepaliveAudio.pause()
    keepaliveAudio.currentTime = 0
  }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none'
    } catch {
      // ignore
    }
  }
}

function cancelSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

function onVisibilityChange() {
  if (!state.trackingActive || state.muted || state.arrivedPlayed) return
  if (document.visibilityState === 'visible') {
    void getCtx().resume()
    void ensureKeepalivePlaying()
    if ('speechSynthesis' in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
    }
  } else {
    // Screen locked / app backgrounded — keep media session alive so timers & voice can continue
    void ensureKeepalivePlaying()
  }
}

function onBeforeUnload() {
  cancelSpeech()
  stopKeepalive()
}

function attachLifecycleListeners() {
  if (listenersAttached) return
  listenersAttached = true
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('beforeunload', onBeforeUnload)
}

function detachLifecycleListeners() {
  if (!listenersAttached) return
  listenersAttached = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('beforeunload', onBeforeUnload)
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

function showSystemNotification(title: string, body: string, tag: string) {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      tag,
      silent: false,
      requireInteraction: tag === 'bus-arrived',
    } as NotificationOptions)
    window.setTimeout(() => n.close(), 12_000)
  } catch {
    // ignore
  }
}

/** Unlock audio on a user gesture (required on mobile) and prepare background keepalive. */
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

/**
 * Start persistent tracking audio. Keeps alerts working while the screen is locked
 * (best-effort on mobile browsers via looping media + notifications).
 */
export async function startTrackingAudio(): Promise<void> {
  cancelSpeech()
  state.muted = false
  state.trackingActive = true
  state.arrivedPlayed = false
  state.enRoutePlayed = false
  state.lastApproachAnnounceAt = 0
  notifyMuteListeners()
  attachLifecycleListeners()
  await unlockAudio()
  await ensureNotificationPermission()
  await ensureKeepalivePlaying()
}

/**
 * Stop voice/beeps. Call when muted, after arrival announcement, or when the app closes.
 */
export function stopTrackingAudio(options?: {
  reason?: 'mute' | 'arrived' | 'closed' | 'user' | 'reset'
  keepMute?: boolean
}): void {
  cancelSpeech()
  stopKeepalive()
  state.trackingActive = false
  if (options?.reason === 'mute' || options?.keepMute) {
    state.muted = true
  }
  if (options?.reason === 'closed' || options?.reason === 'reset') {
    detachLifecycleListeners()
  }
  notifyMuteListeners()
}

export function setMuted(muted: boolean): void {
  if (muted === state.muted) return
  state.muted = muted
  if (muted) {
    cancelSpeech()
    stopKeepalive()
  } else if (state.trackingActive && !state.arrivedPlayed) {
    void ensureKeepalivePlaying()
  }
  notifyMuteListeners()
}

export function toggleMute(): boolean {
  setMuted(!state.muted)
  return state.muted
}

export function resetAlarms(): void {
  cancelSpeech()
  stopKeepalive()
  detachLifecycleListeners()
  if (keepaliveAudio) {
    keepaliveAudio.src = ''
    keepaliveAudio = null
  }
  if (keepaliveUrl) {
    URL.revokeObjectURL(keepaliveUrl)
    keepaliveUrl = null
  }
  state = {
    arrivedPlayed: false,
    enRoutePlayed: false,
    lastApproachAnnounceAt: 0,
    muted: false,
    trackingActive: false,
  }
  notifyMuteListeners()
}

function beep(
  frequency: number,
  durationMs: number,
  startAt: number,
  type: OscillatorType = 'sine',
  gainValue = 0.25,
): void {
  if (state.muted) return
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

function speak(text: string, options?: { notificationTitle?: string; tag?: string }): void {
  if (state.muted) return

  const title = options?.notificationTitle ?? 'School Bus Notifier'
  const tag = options?.tag ?? 'bus-alert'

  // Always mirror to system notification when screen is locked / page hidden
  if (document.visibilityState !== 'visible') {
    showSystemNotification(title, text, tag)
  }

  if (!('speechSynthesis' in window)) {
    showSystemNotification(title, text, tag)
    return
  }

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.95
  utterance.pitch = 1
  utterance.volume = 1
  // Some mobile browsers pause speech when backgrounded; kick synthesis after speak
  utterance.onend = () => {
    void ensureKeepalivePlaying()
  }
  utterance.onerror = () => {
    showSystemNotification(title, text, tag)
    void ensureKeepalivePlaying()
  }
  window.speechSynthesis.speak(utterance)

  // iOS sometimes stalls the speech queue when returning from lock — nudge it
  window.setTimeout(() => {
    if (!state.muted && 'speechSynthesis' in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
    }
  }, 250)
}

/**
 * One-time status when the app opens and the bus is still outside the approach zone.
 */
export function playEnRouteStatusOnce(options: {
  remainingDistanceM: number
  approachDistanceM: number
}): void {
  if (state.arrivedPlayed || state.enRoutePlayed || state.muted) return
  state.enRoutePlayed = true

  const ctx = getCtx()
  const t = ctx.currentTime
  beep(660, 160, t, 'sine', 0.18)

  const text = `Tracking started. School bus is about ${formatSpokenDistance(options.remainingDistanceM)} away by road. You will hear alerts when it is within ${formatSpokenDistance(options.approachDistanceM)}.`
  speak(text, { notificationTitle: 'Tracking started', tag: 'bus-enroute' })
  void ensureKeepalivePlaying()
}

/** Announce when the bus reaches a user-selected route alarm point (once per point) */
export function playWaypointAlarm(options: {
  /** Spoken name: custom tag, or "Alarm point 1" fallback */
  name: string
  remainingDistanceM: number
}): void {
  if (state.arrivedPlayed || state.muted) return

  const ctx = getCtx()
  const t = ctx.currentTime
  beep(740, 160, t, 'triangle', 0.22)
  beep(988, 200, t + 0.2, 'triangle', 0.2)

  const text = `${options.name}. School bus is about ${formatSpokenDistance(options.remainingDistanceM)} away.`
  speak(text, {
    notificationTitle: options.name,
    tag: `bus-waypoint-${options.name}`,
  })
  void ensureKeepalivePlaying()
}

/**
 * Continuous approach announcements while inside the approach distance.
 */
export function playApproachingUpdate(options: {
  remainingDistanceM: number
  announceIntervalSec: number
  force?: boolean
}): void {
  if (state.arrivedPlayed || state.muted) return

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
  state.enRoutePlayed = true

  const ctx = getCtx()
  const t = ctx.currentTime
  beep(880, 180, t, 'square', 0.2)
  beep(1174, 160, t + 0.18, 'square', 0.16)

  const text = `School bus approaching. About ${formatSpokenDistance(options.remainingDistanceM)} by road.`
  speak(text, { notificationTitle: 'Bus approaching', tag: 'bus-approach' })
  void ensureKeepalivePlaying()
}

/** Softer chime + spoken arrival message (once), then stop ongoing voice tracking */
export function playArrivedAlarm(options?: {
  recordingTrip?: 'pickup' | 'drop'
}): void {
  if (state.arrivedPlayed) return
  state.arrivedPlayed = true

  cancelSpeech()

  if (!state.muted) {
    const ctx = getCtx()
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, i) => {
      beep(freq, 350, now + i * 0.22, 'sine', 0.28)
    })

    const tripLabel =
      options?.recordingTrip === 'drop'
        ? 'drop'
        : options?.recordingTrip === 'pickup'
          ? 'pickup'
          : null
    const recordingNote = tripLabel
      ? ` Recording complete. Your ${tripLabel} route is saved and will be available next time. Open Settings to select alarm points along the route.`
      : ''
    const text = `The school bus has arrived at your location.${recordingNote}`

    window.setTimeout(() => {
      if (state.muted) {
        stopTrackingAudio({ reason: 'arrived' })
        return
      }
      speak(text, { notificationTitle: 'Bus arrived', tag: 'bus-arrived' })
      // Final announcement then stop — voice should not continue after arrival
      window.setTimeout(() => {
        stopTrackingAudio({ reason: 'arrived' })
      }, 12_000)
    }, 900)
  } else {
    showSystemNotification(
      'Bus arrived',
      'The school bus has arrived at your location.',
      'bus-arrived',
    )
    stopTrackingAudio({ reason: 'arrived', keepMute: true })
  }
}

export function getAlarmState(): AlarmState {
  return { ...state }
}
