import type { ReactNode } from 'react'
import { BoxView, RunSpan, type SlideOverrides } from '../deck/Shape'
import type { Para, Run, TableShape } from '../deck/types'
import { PARTS } from '../data/answerKey'
import { CONDITIONS, questionCorrect, rate, type Condition, type Rate, type Summary } from '../data/grade'
import { DotPlot, StudyTimeChart } from './charts'
import { digits, remainingMs, type TimerState } from './timer'

function withText(p: Para, text: string, patch: Partial<Run> = {}): ReactNode {
  return <RunSpan r={{ ...p.runs[0], ...patch, t: text }} />
}

function pct(r: Rate) {
  return r.total ? Math.round((r.correct / r.total) * 100) : null
}

/** "67%" in the cell's own style plus a smaller "(4/6)". */
function rateRuns(p: Para, r: Rate, light = false): ReactNode {
  const v = pct(r)
  if (v === null) return undefined
  const base = p.runs[0]
  return (
    <>
      <RunSpan r={{ ...base, t: `${v}%`, bold: true, color: light ? '#FFFFFF' : base.color }} />
      <RunSpan r={{ ...base, t: ` (${r.correct}/${r.total})`, bold: false, size: base.size * 0.78, color: light ? '#EEF3FC' : '#6B7684' }} />
    </>
  )
}

// Slide 16 legend: 0–20, 20–40, 40–60, 60–80, 80–100%.
const HEAT = ['#EEF3FC', '#C9D7F4', '#94B0E8', '#5C85D6', '#2B59C3']
function heat(v: number) {
  return HEAT[Math.min(4, Math.floor(v / 20))]
}

const CONDITION_BY_NAME: Record<string, Condition> = { AI: 'ai', '학습 도우미': 'helper', 독학: 'self' }

function partRate(s: Summary, c: Condition, partId: string) {
  return rate(s.byCondition[c], (r) => r.parts[partId] === 1)
}

/**
 * Slide 16 row label → answer-key part. "7 (1)" → "7번 (1)", "3" → "3번", so each
 * sub-question of a 2-point item gets its own row and its own rate.
 */
function partForRow(t: TableShape, row: number) {
  const label = t.rows[row]?.cells[0]?.paras.flatMap((p) => p.runs.map((r) => r.t)).join('').trim() ?? ''
  const m = label.match(/^(\d+)\s*(\(\d\))?$/)
  if (!m) return undefined
  const id = m[2] ? `${m[1]}번 ${m[2]}` : `${m[1]}번`
  return PARTS.find((p) => p.id === id)
}

/** Table rows on slides 17–18 → the statistic each row shows. */
const TABLE_ROWS: Record<string, ((s: Summary, c: Condition) => Rate)[]> = {
  'Scholarship Table': [(s, c) => s.questionRates[c][3], (s, c) => partRate(s, c, '7번 (2)')],
  'Age Table': [(s, c) => s.questionRates[c][1], (s, c) => rate(s.byCondition[c], (r) => questionCorrect(r, 8))],
}

export function resultOverrides(n: number, summary: Summary): SlideOverrides | undefined {
  if (n === 15) {
    return {
      replace: (s) => (s.kind === 'chart' ? <DotPlot s={s} byCondition={summary.byCondition} /> : undefined),
      box: (s) => {
        const m = s.name.match(/^Stat (.+) (인원|평균|범위)$/)
        if (!m) return undefined
        const rs = summary.byCondition[CONDITION_BY_NAME[m[1]]]
        if (!rs?.length) return undefined
        const scores = rs.map((r) => r.score)
        const text =
          m[2] === '인원'
            ? String(rs.length)
            : m[2] === '평균'
              ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
              : `${Math.min(...scores)}–${Math.max(...scores)}`
        return { para: (p) => withText(p, text) }
      },
    }
  }
  if (n === 16) {
    return {
      cell: (t, row, col) => {
        if (t.name !== 'Item Accuracy Table' || row === 0 || col < 2) return undefined
        const part = partForRow(t, row)
        if (!part) return undefined
        const r = partRate(summary, CONDITIONS[col - 2], part.id)
        const v = pct(r)
        if (v === null) return undefined
        return { fill: heat(v), para: (p) => rateRuns(p, r, v >= 60) }
      },
    }
  }
  if (n === 17 || n === 18) {
    return {
      cell: (t, row, col) => {
        const rows = TABLE_ROWS[t.name]
        if (!rows || row === 0 || col < 1 || !rows[row - 1]) return undefined
        const r = rows[row - 1](summary, CONDITIONS[col - 1])
        return { para: (p) => rateRuns(p, r) }
      },
    }
  }
  if (n === 21) {
    return { replace: (s) => (s.kind === 'chart' ? <StudyTimeChart s={s} /> : undefined) }
  }
  return undefined
}

/** Slides 10 and 12: the countdown replaces the PPT's animated digit stacks. */
export function timerOverrides(t: TimerState, now: number): SlideOverrides {
  const left = remainingMs(t, now)
  const done = left === 0
  const text = digits(left)
  // The PPT wipes each of the 60 segments out from the right over 1/60 of the
  // duration, rightmost first, so the bar drains continuously.
  const filled = (left / t.durationMs) * 60
  const lastMinute = left <= 60_000 && (t.startedAt !== null || t.elapsedBeforeMs > 0)
  return {
    replace: (s) => {
      if (/^Timer (p\d|colon|cover|end)/.test(s.name)) return null
      const seg = s.name.match(/^Progress Seg (\d+)$/)
      if (seg && s.kind === 'box') {
        const visible = Math.min(1, Math.max(0, filled - (Number(seg[1]) - 1)))
        if (visible <= 0) return null
        return visible >= 1 ? undefined : <BoxView s={{ ...s, w: s.w * visible }} />
      }
      if (s.name === 'Self Check' && !lastMinute) return null
      if (s.name === 'Rule Note' && lastMinute) return null
      return undefined
    },
    box: (s) => {
      const m = s.name.match(/^Timer start (\d)$/)
      if (!m) return undefined
      const ch = text[Number(m[1])] ?? ''
      return { para: (p) => withText(p, ch, done ? { color: '#6F9BFF' } : {}) }
    },
  }
}
