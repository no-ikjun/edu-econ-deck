import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import deckJson from './deck/slides.json'
import type { DeckData } from './deck/types'
import { Slide } from './deck/Slide'
import { useResults } from './data/useResults'
import { BUILD_STEPS, resultOverrides, timerOverrides, type Build } from './live/overrides'
import { TIMER_SLIDES, initialTimers, reset, toggle, useNow, type TimerState } from './live/timer'
import { DataPanel } from './DataPanel'

const deck = deckJson as DeckData
const COUNT = deck.slides.length
const RESULT_SLIDES = new Set([14, 16, 17, 18, 19, 20])

function slideFromHash() {
  const n = Number(window.location.hash.replace(/^#\/?/, ''))
  return Number.isInteger(n) && n >= 1 && n <= COUNT ? n : 1
}

function useStageScale() {
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / deck.width, window.innerHeight / deck.height))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return scale
}

export default function App() {
  const [n, setN] = useState(slideFromHash)
  const [panel, setPanel] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [timers, setTimers] = useState<Record<number, TimerState>>(initialTimers)
  const [build, setBuild] = useState<Build>({ shown: 0, animate: false })
  const jump = useRef('')
  const scale = useStageScale()
  const results = useResults()
  const { selectUpload } = results
  const anyRunning = Object.values(timers).some((t) => t.startedAt !== null)
  const now = useNow(anyRunning)

  /** `atEnd` shows every build at once, as PowerPoint does when you step back into a slide. */
  const go = useCallback((next: number, atEnd = false) => {
    const clamped = Math.max(1, Math.min(COUNT, next))
    setN(clamped)
    setBuild({ shown: atEnd ? (BUILD_STEPS[clamped] ?? 0) : 0, animate: false })
    history.replaceState(null, '', `#/${clamped}`)
  }, [])

  // Next/previous click: play or undo this slide's builds before changing slides.
  const forward = useCallback(() => {
    if (build.shown < (BUILD_STEPS[n] ?? 0)) setBuild({ shown: build.shown + 1, animate: true })
    else go(n + 1)
  }, [n, build, go])
  const back = useCallback(() => {
    if (build.shown > 0) setBuild({ shown: build.shown - 1, animate: false })
    else go(n - 1, true)
  }, [n, build, go])

  // Like the PPT (onBegin trigger), a timer starts by itself the first time its
  // slide appears. Space pauses, R resets to the full time and waits.
  useEffect(() => {
    if (!(n in TIMER_SLIDES)) return
    setTimers((t) => {
      const cur = t[n]
      if (cur.startedAt !== null || cur.elapsedBeforeMs > 0 || cur.touched) return t
      return { ...t, [n]: { ...toggle(cur, Date.now()), touched: true } }
    })
  }, [n])

  // Warm the cache so photo slides appear instantly even on slow classroom Wi-Fi.
  useEffect(() => {
    const srcs = new Set<string>()
    for (const s of deck.slides) for (const sh of s.shapes) if (sh.kind === 'image') srcs.add(sh.src)
    srcs.forEach((src) => {
      const img = new Image()
      img.src = `${import.meta.env.BASE_URL}${src}`
    })
  }, [])

  useEffect(() => {
    const onHash = () => {
      setN(slideFromHash())
      setBuild({ shown: 0, animate: false })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key === 'Escape') {
        setPanel(false)
        ;(document.activeElement as HTMLElement | null)?.blur()
        return
      }
      if (target.closest('input, textarea, select, button')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const isTimer = n in TIMER_SLIDES
      if (/^\d$/.test(e.key)) {
        jump.current = (jump.current + e.key).slice(-2)
        return
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
          forward()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          back()
          break
        case ' ':
          if (isTimer) setTimers((t) => ({ ...t, [n]: toggle(t[n], Date.now()) }))
          else if (e.shiftKey) back()
          else forward()
          break
        case 'Enter':
          if (jump.current) go(Number(jump.current))
          else forward()
          jump.current = ''
          break
        case 'Home':
          go(1)
          break
        case 'End':
          go(COUNT)
          break
        case 'r':
        case 'R':
          if (isTimer) setTimers((t) => ({ ...t, [n]: reset(t[n]) }))
          break
        case 'f':
        case 'F':
          if (document.fullscreenElement) document.exitFullscreen()
          else document.documentElement.requestFullscreen().catch(() => {})
          break
        case 'd':
        case 'D':
          setPanel((p) => !p)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, go, forward, back])

  // Drop a CSV anywhere on the page to load it.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const drop = async (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) selectUpload(await file.text(), file.name)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [selectUpload])

  const slide = deck.slides[n - 1]
  const overrides = useMemo(
    () => (n in TIMER_SLIDES ? timerOverrides(timers[n], now) : resultOverrides(n, results.summary, build, slide)),
    [n, timers, now, results.summary, build, slide],
  )

  const onClick = (e: React.MouseEvent) => {
    if (panel) return
    if (n in TIMER_SLIDES && (e.target as HTMLElement).closest('[data-name^="Timer"]')) {
      setTimers((t) => ({ ...t, [n]: toggle(t[n], Date.now()) }))
      return
    }
    if (e.clientX < window.innerWidth / 4) back()
    else forward()
  }

  const live = RESULT_SLIDES.has(n)
  return (
    <div className="viewport" onClick={onClick}>
      <div
        className="stage"
        style={{
          width: deck.width,
          height: deck.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        <Slide slide={slide} overrides={overrides} />
      </div>
      {live && (
        <div
          className={`status-dot ${results.source === 'sheet' ? (results.status.ok ? 'ok' : 'err') : 'other'}`}
          title={results.source === 'sheet' ? '구글 시트 연결' : results.source === 'upload' ? 'CSV 파일' : '샘플 데이터'}
        />
      )}
      {dragging && <div className="drop">CSV 파일을 놓으면 결과에 반영돼요</div>}
      {panel && <DataPanel results={results} onClose={() => setPanel(false)} />}
    </div>
  )
}
