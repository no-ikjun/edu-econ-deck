import { useEffect, useState } from 'react'

export type TimerState = {
  durationMs: number
  startedAt: number | null
  elapsedBeforeMs: number
  /** Set once the slide has auto-started it, so a reset (R) stays paused. */
  touched?: boolean
}

export const TIMER_SLIDES: Record<number, number> = { 10: 13 * 60_000, 12: 7 * 60_000 }

export function initialTimers(): Record<number, TimerState> {
  return Object.fromEntries(
    Object.entries(TIMER_SLIDES).map(([n, d]) => [n, { durationMs: d, startedAt: null, elapsedBeforeMs: 0 }]),
  )
}

export function remainingMs(t: TimerState, now: number) {
  const elapsed = t.elapsedBeforeMs + (t.startedAt !== null ? now - t.startedAt : 0)
  return Math.max(0, t.durationMs - elapsed)
}

export function toggle(t: TimerState, now: number): TimerState {
  if (t.startedAt !== null) return { ...t, startedAt: null, elapsedBeforeMs: t.elapsedBeforeMs + now - t.startedAt }
  if (remainingMs(t, now) === 0) return t
  return { ...t, startedAt: now }
}

export function reset(t: TimerState): TimerState {
  return { ...t, startedAt: null, elapsedBeforeMs: 0 }
}

/** Re-renders every animation frame while any timer runs, so the bar drains smoothly. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    let id = 0
    const tick = () => {
      setNow(Date.now())
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [active])
  return active ? now : Date.now()
}

/** "13:00" style digits; seconds round up so the display hits 00:00 exactly at the end. */
export function digits(ms: number) {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
