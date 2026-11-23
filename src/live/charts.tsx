import type { ChartShape } from '../deck/types'
import { CONDITIONS, type Condition, type Response } from '../data/grade'
import { MAX_SCORE } from '../data/answerKey'

export const CONDITION_COLOR: Record<Condition, string> = { ai: '#2B59C3', helper: '#B4621A', self: '#0F7B6C' }
const FONT = 28 // 14pt

/**
 * Slide 15 dot plot (chart1). Matches the PPT chart: inner plot area at
 * x 16% / y 4% / w 80% / h 82% of the frame, x axis 0–16 step 2, y axis 0.5–3.8
 * with AI at 3, 학습 도우미 at 2, 독학 at 1. Equal scores stack upward.
 */
export function DotPlot({ s, byCondition }: { s: ChartShape; byCondition: Record<Condition, Response[]> }) {
  const plot = { x: s.w * 0.16, y: s.h * 0.04, w: s.w * 0.8, h: s.h * 0.82 }
  const X = (v: number) => plot.x + (v / MAX_SCORE) * plot.w
  const Y = (v: number) => plot.y + ((3.8 - v) / 3.3) * plot.h
  const rowValue: Record<Condition, number> = { ai: 3, helper: 2, self: 1 }
  const dot = 18 // 9pt marker
  const ticks = Array.from({ length: MAX_SCORE / 2 + 1 }, (_, i) => i * 2)

  return (
    <svg data-name={s.name} style={{ position: 'absolute', left: s.x, top: s.y, overflow: 'visible' }} width={s.w} height={s.h}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X(t)} x2={X(t)} y1={plot.y} y2={plot.y + plot.h} stroke="#E5E8EB" strokeWidth={1} />
          <text x={X(t)} y={plot.y + plot.h + 40} textAnchor="middle" fontSize={FONT} fill="#4E5968">
            {t}점
          </text>
        </g>
      ))}
      <line x1={plot.x} x2={plot.x + plot.w} y1={plot.y + plot.h} y2={plot.y + plot.h} stroke="#D1D6DB" strokeWidth={1.5} />
      {CONDITIONS.map((c) => {
        const rs = byCondition[c]
        const counts = new Map<number, number>()
        const y0 = Y(rowValue[c])
        const mean = rs.length ? rs.reduce((a, r) => a + r.score, 0) / rs.length : null
        return (
          <g key={c}>
            {rs
              .slice()
              .sort((a, b) => a.row - b.row)
              .map((r) => {
                const k = counts.get(r.score) ?? 0
                counts.set(r.score, k + 1)
                return (
                  <circle
                    key={r.row}
                    className="dot-in"
                    cx={X(r.score)}
                    cy={y0 - k * (dot - 2)}
                    r={dot / 2}
                    fill={CONDITION_COLOR[c]}
                    stroke="#FFFFFF"
                    strokeWidth={1.5}
                  />
                )
              })}
            {mean !== null && (
              <rect
                className="mean-move"
                x={-11}
                y={-11}
                width={22}
                height={22}
                fill="#191F28"
                style={{ transform: `translate(${X(mean)}px, ${y0 + 26}px) rotate(45deg) scale(0.72)` }}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Slide 22 right chart (chart2): study time, horizontal bars, axis max 70. */
export function StudyTimeChart({ s }: { s: ChartShape }) {
  const data = [
    { label: 'AI 튜터', value: 49, color: '#2B59C3' },
    { label: '대면 능동학습', value: 60, color: '#B0B8C1' },
  ]
  const labelW = 200
  const plotW = s.w - labelW - 24
  const band = s.h / data.length
  const barH = band / 1.5 // gapWidth 50%
  return (
    <svg data-name={s.name} style={{ position: 'absolute', left: s.x, top: s.y, overflow: 'visible' }} width={s.w} height={s.h}>
      <line x1={labelW} x2={labelW} y1={0} y2={s.h} stroke="#C6C7C9" strokeWidth={1.5} />
      {data.map((d, i) => {
        const cy = band * i + band / 2
        const w = (d.value / 70) * plotW
        return (
          <g key={d.label}>
            <text x={labelW - 16} y={cy} dominantBaseline="central" textAnchor="end" fontSize={FONT} fill="#191F28">
              {d.label}
            </text>
            <rect x={labelW} y={cy - barH / 2} width={w} height={barH} fill={d.color} />
            <text x={labelW + w + 12} y={cy} dominantBaseline="central" fontSize={FONT} fontWeight={700} fill="#191F28">
              {d.value}분
            </text>
          </g>
        )
      })}
    </svg>
  )
}
