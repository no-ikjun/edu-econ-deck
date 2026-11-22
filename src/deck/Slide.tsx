import type { SlideData } from './types'
import { ShapeView, type SlideOverrides } from './Shape'

export function Slide({ slide, overrides }: { slide: SlideData; overrides?: SlideOverrides }) {
  return (
    <div className="slide" style={{ background: slide.bg }}>
      {slide.shapes.map((s, i) => (
        <ShapeView key={i} s={s} o={overrides} />
      ))}
    </div>
  )
}
