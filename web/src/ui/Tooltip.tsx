// One global tooltip for every element with a `data-tip` attribute (event delegation; works inside scrolling
// panels without clipping). Shown after a short hover delay or on keyboard focus. While shown it follows its element's
// `data-tip` (a button whose meaning changes under the pointer, e.g. Pause back to Play when playback stops by itself;
// brief 6 review WFP-R8), and closes when the attribute goes.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TipState {
  text: string
  x: number
  y: number
  place: 'top' | 'bottom'
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  const [dx, setDx] = useState(0)

  useEffect(() => {
    let timer: number | undefined
    let current: HTMLElement | null = null
    let watch: MutationObserver | null = null
    const unwatch = () => {
      watch?.disconnect()
      watch = null
    }
    const show = (el: HTMLElement) => {
      unwatch()
      const text = el.dataset.tip
      if (!text || !el.isConnected) return
      const r = el.getBoundingClientRect()
      const place: TipState['place'] = r.top > 56 ? 'top' : 'bottom'
      setTip({ text, x: r.left + r.width / 2, y: place === 'top' ? r.top - 7 : r.bottom + 7, place })
      // the shown text follows the element's data-tip while it is the current one
      if (typeof MutationObserver === 'undefined') return
      watch = new MutationObserver(() => {
        if (current !== el) return unwatch()
        if (el.dataset.tip) show(el)
        else {
          unwatch()
          setTip(null)
        }
      })
      watch.observe(el, { attributes: true, attributeFilter: ['data-tip'] })
    }
    const target = (e: Event) => ((e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null) ?? null
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = target(e)
      if (el === current) return
      current = el
      window.clearTimeout(timer)
      unwatch()
      if (!el) {
        setTip(null)
        return
      }
      timer = window.setTimeout(() => show(el), 380)
    }
    const focus = (e: FocusEvent) => {
      const el = target(e)
      if (!el || !(e.target as HTMLElement).matches?.(':focus-visible')) return
      current = el
      window.clearTimeout(timer)
      show(el)
    }
    const hide = () => {
      window.clearTimeout(timer)
      unwatch()
      current = null
      setTip(null)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      unwatch()
      document.removeEventListener('pointerover', over)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // keep the bubble inside the viewport horizontally
  useLayoutEffect(() => {
    const el = ref.current
    if (!tip || !el) return
    const w = el.offsetWidth
    const left = tip.x - w / 2
    const right = tip.x + w / 2
    const vw = window.innerWidth
    setDx(left < 8 ? 8 - left : right > vw - 8 ? vw - 8 - right : 0)
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={`tooltip tooltip-${tip.place}`}
      style={{ left: tip.x + dx, top: tip.y, ['--arrow-dx' as string]: `${-dx}px` }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
