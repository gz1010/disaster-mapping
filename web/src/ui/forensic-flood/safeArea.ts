// The Forensic workspace's safe area (owner: web-flood-forensic since brief 5; moved unchanged from
// ui/shell/ForensicWorkspace.tsx so the fire scene and the 3D flood view share it).
import { useLayoutEffect, type RefObject } from 'react'
import { parseDockSide, safeInsetsFor, type ChromeRect, type DockSide } from '../shell/layout'

/** Publish the uncovered canvas area as CSS vars (measured from the panels, so it follows responsive sizes; the scene
 *  reads them into sceneStore.viewInsets for camera framing and positions its overlays with them). Each panel docks
 *  to the edge its --chrome-side names (styles/forensic-narrow.css: the right column docks to the bottom on phones).
 *  `layoutKey` re-measures when a panel moves without resizing (the dock follows the phone sheet). */
export function useSafeArea(collapsed: boolean, refs: { header: RefObject<HTMLElement | null>; right: RefObject<HTMLElement | null>; dock: RefObject<HTMLElement | null> }, layoutKey: string) {
  useLayoutEffect(() => {
    const root = document.documentElement
    const update = () => {
      const gap = parseFloat(getComputedStyle(root).getPropertyValue('--gap')) || 12
      const items: ChromeRect[] = []
      const add = (el: HTMLElement | null | undefined, fallback: DockSide) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const side = parseDockSide(getComputedStyle(el).getPropertyValue('--chrome-side'))
        items.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, side: side === 'none' ? fallback : side })
      }
      add(refs.header.current, 'top')
      if (!collapsed) {
        add(refs.right.current, 'right')
        add(refs.dock.current, 'bottom')
      }
      const ins = safeInsetsFor(items, window.innerWidth, window.innerHeight, gap)
      root.style.setProperty('--safe-top', `${ins.top}px`)
      root.style.setProperty('--safe-right', `${ins.right}px`)
      root.style.setProperty('--safe-bottom', `${ins.bottom}px`)
      root.style.setProperty('--safe-left', `${ins.left}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    for (const r of [refs.header, refs.right, refs.dock]) if (r.current) ro.observe(r.current)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [collapsed, refs.header, refs.right, refs.dock, layoutKey])
}
