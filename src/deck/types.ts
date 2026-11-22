export type Spacing = { pct?: number; px?: number }

export type Run = {
  t: string
  size: number
  bold: boolean
  color: string
  spacing?: number
  italic?: boolean
  underline?: boolean
  baseline?: number
  br?: boolean
}

export type Para = {
  align: 'l' | 'ctr' | 'r' | 'just'
  lineSpacing: Spacing
  spaceBefore?: Spacing
  spaceAfter?: Spacing
  marL: number
  indent: number
  bullet?: { char: string; color: string }
  runs: Run[]
}

export type Body = {
  insets: { l: number; t: number; r: number; b: number }
  anchor: 't' | 'ctr' | 'b'
  wrap: 'square' | 'none'
}

export type Stroke = { w: number; color: string; dash?: string; headEnd?: string; tailEnd?: string }

export type Cell = {
  paras: Para[]
  pad: { l: number; r: number; t: number; b: number }
  anchor?: 't' | 'ctr' | 'b'
  fill?: string
  border_top?: Stroke
  border_bottom?: Stroke
  border_left?: Stroke
  border_right?: Stroke
}

type Base = {
  name: string
  x: number
  y: number
  w: number
  h: number
  rot?: number
  flipH?: boolean
  flipV?: boolean
}

export type BoxShape = Base & {
  kind: 'box'
  geom?: string
  adj?: number
  fill?: string
  stroke?: Stroke
  body?: Body
  paras?: Para[]
  placeholder?: string
}
export type LineShape = Base & { kind: 'line'; stroke?: Stroke }
export type ImageShape = Base & {
  kind: 'image'
  src: string
  crop?: { l?: number; t?: number; r?: number; b?: number }
  stroke?: Stroke
}
export type TableShape = Base & { kind: 'table'; cols: number[]; rows: { h: number; cells: Cell[] }[] }
export type ChartShape = Base & { kind: 'chart'; chart: string }
export type GroupShape = Base & { kind: 'group'; children: Shape[] }

export type Shape = BoxShape | LineShape | ImageShape | TableShape | ChartShape | GroupShape

export type SlideData = { n: number; bg: string; shapes: Shape[] }
export type DeckData = { width: number; height: number; slides: SlideData[] }
