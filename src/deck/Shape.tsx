import type { CSSProperties, ReactNode } from 'react'
import type { Body, BoxShape, Cell, ImageShape, LineShape, Para, Shape, Stroke, TableShape } from './types'

// Pretendard's ascent + descent is (1950 + 494) / 2048 ≈ 1.193em, which is what
// PowerPoint treats as "single" line spacing for this font.
const SINGLE_LINE = 1.193

const ALIGN: Record<Para['align'], CSSProperties['textAlign']> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
}
const ANCHOR: Record<Body['anchor'], CSSProperties['justifyContent']> = {
  t: 'flex-start',
  ctr: 'center',
  b: 'flex-end',
}

function maxSize(p: Para) {
  return Math.max(...p.runs.map((r) => r.size || 0), 1)
}

function spacingPx(s: Para['spaceBefore'], p: Para) {
  if (!s) return 0
  if (s.px !== undefined) return s.px
  return (s.pct ?? 0) * maxSize(p) * SINGLE_LINE
}

function lineHeight(p: Para) {
  if (p.lineSpacing.px !== undefined) return p.lineSpacing.px
  return (p.lineSpacing.pct ?? 1) * SINGLE_LINE * maxSize(p)
}

/** Renders one paragraph. `override` replaces the paragraph's runs when given. */
export function Paragraph({ p, first, nowrap, children }: { p: Para; first: boolean; nowrap?: boolean; children?: ReactNode }) {
  const style: CSSProperties = {
    margin: 0,
    textAlign: ALIGN[p.align] ?? 'left',
    // The paragraph's own font size sets the line "strut"; matching it to the
    // largest run keeps the line box at exactly lineHeight.
    fontSize: maxSize(p),
    lineHeight: `${lineHeight(p)}px`,
    paddingLeft: p.marL,
    marginTop: first ? 0 : spacingPx(p.spaceBefore, p),
    marginBottom: spacingPx(p.spaceAfter, p),
    whiteSpace: nowrap ? 'pre' : 'pre-wrap',
    position: 'relative',
    // PowerPoint wraps Korean between any two syllables, not only at spaces.
    wordBreak: 'normal',
    overflowWrap: 'anywhere',
  }
  return (
    <p style={style}>
      {p.bullet && (
        <span
          style={{
            position: 'absolute',
            left: p.marL + p.indent,
            color: p.bullet.color,
            fontSize: p.runs[0]?.size,
            fontFamily: 'Arial, sans-serif',
          }}
        >
          {p.bullet.char}
        </span>
      )}
      {children ?? p.runs.map((r, i) => <RunSpan key={i} r={r} />)}
    </p>
  )
}

export function RunSpan({ r }: { r: Para['runs'][number] }) {
  if (r.br) return <br />
  return (
    <span
      style={{
        fontSize: r.size,
        fontWeight: r.bold ? 700 : 400,
        color: r.color,
        letterSpacing: r.spacing ? `${r.spacing}px` : undefined,
        fontStyle: r.italic ? 'italic' : undefined,
        textDecoration: r.underline ? 'underline' : undefined,
        verticalAlign: r.baseline ? `${r.baseline}%` : undefined,
      }}
    >
      {r.t}
    </span>
  )
}

export function TextFrame({ body, paras, override }: { body: Body; paras: Para[]; override?: (p: Para, i: number) => ReactNode }) {
  const nowrap = body.wrap === 'none'
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: ANCHOR[body.anchor] ?? 'flex-start',
        padding: `${body.insets.t}px ${body.insets.r}px ${body.insets.b}px ${body.insets.l}px`,
      }}
    >
      <div>
        {paras.map((p, i) => (
          <Paragraph key={i} p={p} first={i === 0} nowrap={nowrap}>
            {override?.(p, i)}
          </Paragraph>
        ))}
      </div>
    </div>
  )
}

function frameStyle(s: Shape): CSSProperties {
  const transforms = []
  if (s.rot) transforms.push(`rotate(${s.rot}deg)`)
  if (s.flipH) transforms.push('scaleX(-1)')
  if (s.flipV) transforms.push('scaleY(-1)')
  return {
    position: 'absolute',
    left: s.x,
    top: s.y,
    width: s.w,
    height: s.h,
    transform: transforms.length ? transforms.join(' ') : undefined,
  }
}

function dashArray(stroke: Stroke) {
  if (!stroke.dash) return undefined
  const w = stroke.w
  return stroke.dash.includes('sysDot') || stroke.dash === 'dot' ? `${w} ${w}` : `${w * 4} ${w * 3}`
}

function strokeOverlay(stroke: Stroke | undefined, radius?: number): ReactNode {
  if (!stroke) return null
  // PowerPoint centers strokes on the shape edge.
  return (
    <div
      style={{
        position: 'absolute',
        inset: -stroke.w / 2,
        border: `${stroke.w}px ${stroke.dash ? 'dashed' : 'solid'} ${stroke.color}`,
        borderRadius: radius !== undefined ? radius + stroke.w / 2 : undefined,
        pointerEvents: 'none',
      }}
    />
  )
}

export type BoxOverride = {
  /** Replace the runs of paragraph `i`; return undefined to keep the original. */
  para?: (p: Para, i: number) => ReactNode
  fill?: string
  children?: ReactNode
}

export function BoxView({ s, override }: { s: BoxShape; override?: BoxOverride }) {
  const radius = s.geom === 'roundRect' ? (s.adj ?? 0.16667) * Math.min(s.w, s.h) : s.geom === 'ellipse' ? undefined : 0
  const fill = override?.fill ?? (s.fill && s.fill !== 'none' ? s.fill : undefined)
  return (
    <div
      data-name={s.name}
      style={{
        ...frameStyle(s),
        background: fill,
        borderRadius: s.geom === 'ellipse' ? '50%' : radius,
      }}
    >
      {strokeOverlay(s.stroke, radius)}
      {s.body && s.paras && <TextFrame body={s.body} paras={s.paras} override={override?.para} />}
      {override?.children}
    </div>
  )
}

function LineView({ s }: { s: LineShape }) {
  const stroke = s.stroke ?? { w: 1, color: '#000' }
  const pad = Math.max(stroke.w * 4, 8)
  const x1 = s.flipH ? s.w : 0
  const x2 = s.flipH ? 0 : s.w
  const y1 = s.flipV ? s.h : 0
  const y2 = s.flipV ? 0 : s.h
  const id = `arrow-${s.name.replace(/\W/g, '')}-${Math.round(s.x)}-${Math.round(s.y)}`
  return (
    <svg
      data-name={s.name}
      style={{ position: 'absolute', left: s.x - pad, top: s.y - pad, overflow: 'visible' }}
      width={s.w + pad * 2}
      height={s.h + pad * 2}
    >
      {stroke.tailEnd && (
        <defs>
          <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3" markerHeight="3" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={stroke.color} />
          </marker>
        </defs>
      )}
      <line
        x1={x1 + pad}
        y1={y1 + pad}
        x2={x2 + pad}
        y2={y2 + pad}
        stroke={stroke.color}
        strokeWidth={stroke.w}
        strokeDasharray={dashArray(stroke)}
        markerEnd={stroke.tailEnd ? `url(#${id})` : undefined}
      />
    </svg>
  )
}

function ImageView({ s }: { s: ImageShape }) {
  const c = { l: 0, t: 0, r: 0, b: 0, ...s.crop }
  const fullW = s.w / (1 - c.l - c.r)
  const fullH = s.h / (1 - c.t - c.b)
  return (
    <div data-name={s.name} style={{ ...frameStyle(s), overflow: 'hidden' }}>
      <img
        src={`${import.meta.env.BASE_URL}${s.src}`}
        alt=""
        draggable={false}
        style={{ position: 'absolute', left: -c.l * fullW, top: -c.t * fullH, width: fullW, height: fullH, maxWidth: 'none' }}
      />
      {strokeOverlay(s.stroke, 0)}
    </div>
  )
}

export type CellOverride = { para?: (p: Para, i: number) => ReactNode; fill?: string }

function border(b?: Stroke) {
  return b ? `${b.w}px solid ${b.color}` : undefined
}

function CellView({ c, w, h, override }: { c: Cell; w: number; h: number; override?: CellOverride }) {
  const anchor = c.anchor ?? 't'
  return (
    <td
      style={{
        width: w,
        height: h,
        padding: `${c.pad.t}px ${c.pad.r}px ${c.pad.b}px ${c.pad.l}px`,
        background: override?.fill ?? c.fill,
        borderTop: border(c.border_top),
        borderBottom: border(c.border_bottom),
        verticalAlign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
      }}
    >
      {c.paras.map((p, i) => (
        <Paragraph key={i} p={p} first={i === 0}>
          {override?.para?.(p, i)}
        </Paragraph>
      ))}
    </td>
  )
}

function TableView({ s, cell }: { s: TableShape; cell?: (row: number, col: number) => CellOverride | undefined }) {
  return (
    <div data-name={s.name} style={{ position: 'absolute', left: s.x, top: s.y, width: s.w }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: s.cols.reduce((a, b) => a + b, 0) }}>
        <colgroup>
          {s.cols.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {s.rows.map((r, ri) => (
            <tr key={ri} style={{ height: r.h }}>
              {r.cells.map((c, ci) => (
                <CellView key={ci} c={c} w={s.cols[ci]} h={r.h} override={cell?.(ri, ci)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export type SlideOverrides = {
  /** Replace a shape entirely (return null to hide it). */
  replace?: (s: Shape) => ReactNode | undefined
  box?: (s: BoxShape) => BoxOverride | undefined
  cell?: (table: TableShape, row: number, col: number) => CellOverride | undefined
}

export function ShapeView({ s, o }: { s: Shape; o?: SlideOverrides }) {
  const replaced = o?.replace?.(s)
  if (replaced !== undefined) return <>{replaced}</>
  switch (s.kind) {
    case 'box':
      return <BoxView s={s} override={o?.box?.(s)} />
    case 'line':
      return <LineView s={s} />
    case 'image':
      return <ImageView s={s} />
    case 'table':
      return <TableView s={s} cell={o?.cell ? (r, c) => o.cell!(s, r, c) : undefined} />
    case 'group':
      return (
        <>
          {s.children.map((c, i) => (
            <ShapeView key={i} s={c} o={o} />
          ))}
        </>
      )
    case 'chart':
      return null
  }
}
