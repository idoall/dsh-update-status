/**
 * dsh-update-status — update-indicator styling specs.
 *
 * Product decision: an available update repaints NOTHING in the sidebar. The
 * `DeepSeek + version` chip keeps its normal fill and the only signal is the
 * amber dot, which breathes (scale) with a soft halo that grows and shrinks
 * along with it. The chip used to turn solid amber, which recoloured the whole
 * brand row for a state that is not a chip state.
 *
 * These assertions are deliberately structural rather than pixel-exact: they
 * lock the two halves of the decision (chip unchanged, dot breathing) and the
 * reduced-motion escape hatch.
 */
import { describe, expect, it } from 'vitest'
import { UPDATE_STATUS_CSS as CSS } from '../../src/client/styles.ts'

/** One CSS line of the plugin sheet; every rule is authored on a single line. */
function line(selector: string): string {
  const found = CSS.split('\n').map(value => value.trim()).filter(value => value.startsWith(`${selector}{`))
  expect(found.length, `expected exactly one rule for ${selector}`).toBe(1)
  return found[0]!
}

describe('update indicator styling', () => {
  it('never repaints the version chip when an update is available', () => {
    expect(CSS).not.toContain('.dus-badge[data-update')
  })

  it('renders the chip as a neutral second-level surface, not a high-contrast pill', () => {
    const chip = line('.dus-badge')
    // Grey in both themes (#f1f3f5 light / #353638 dark), so the amber halo keeps
    // its contrast on the dark shell instead of sitting on a white frame.
    expect(chip).toContain('--dus-badge-surface:var(--dsw-alias-button-floating-hover,#f1f3f5)')
    expect(chip).toContain('background:var(--dus-badge-surface)')
    // Text follows the theme label, i.e. white on the dark shell, near-black on the light one.
    expect(chip).toContain('color:var(--dsw-alias-label-primary,#0f1115)')
    expect(chip).not.toContain('label-primary-inverted')
  })

  it('lifts the chip on hover in both themes, with a brightness fallback', () => {
    // brightness() alone turns the light-theme chip pure white, i.e. invisible; the
    // theme-colour mix is what darkens it in light mode and lightens it in dark mode.
    expect(line('.dus-badge:hover')).toContain('filter:brightness(1.08)')
    const supports = line('@supports (background:color-mix(in srgb,red 50%,transparent))')
    expect(supports).toContain('background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--dus-badge-surface))')
    expect(supports).toContain('filter:none')
    // The guard must come after the fallback so it wins wherever color-mix exists.
    expect(CSS.indexOf('@supports (background:color-mix')).toBeGreaterThan(CSS.indexOf('.dus-badge:hover{filter:brightness'))
  })

  it('keeps the error chip fill and makes its label theme-correct', () => {
    const error = line('.dus-badge[data-error=true]')
    expect(error).toContain('background:var(--dsw-alias-state-error-primary')
    // The shell's own badge pattern: bg-layer-3 label, readable on both error reds.
    expect(error).toContain('color:var(--dsw-alias-bg-layer-3,#fff)')
  })

  it('marks the up-to-date state with a plain green circle', () => {
    const current = line('.dus-dot[data-state=current]')
    expect(current).toContain('background:var(--dsw-alias-state-success-primary,#22c55e)')
    expect(current).toContain('opacity:1')
    // Green says "nothing to do": it must never animate or glow.
    expect(current).not.toContain('animation')
    expect(current).not.toContain('box-shadow')
    // Precedence: up-to-date is the quietest, so the louder states are declared after it.
    const order = ['.dus-dot[data-state=current]{', '.dus-dot[data-loading=true]{', '.dus-dot[data-update=true]{']
      .map(selector => CSS.indexOf(selector))
    expect(order.every(index => index > 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it('marks an update with an amber dot that carries a halo', () => {
    const dot = line('.dus-dot[data-update=true]')
    expect(dot).toContain('background:var(--dus-update-color)')
    expect(dot).toContain('--dus-update-color:var(--dsw-alias-state-warn-primary')
    // The circle itself stays on the shared rule; only the update state adds the glow.
    expect(line('.dus-dot')).toContain('border-radius:50%')
  })

  it('breathes the dot and its halo together, never as a ripple', () => {
    expect(line('.dus-dot[data-update=true]')).toContain('animation:dus-update-pulse')
    const frames = line('@keyframes dus-update-pulse')
    expect(frames).toContain('0%,100%{box-shadow:')
    expect(frames).toContain('50%{box-shadow:')
    expect(frames.match(/transform:scale\(/g)?.length).toBe(2)
  })

  it('haloes in the theme warn colour, with a literal fallback declared first', () => {
    const frames = line('@keyframes dus-update-pulse')
    // A literal amber precedes each color-mix, so an engine without color-mix
    // keeps a halo instead of losing the declaration entirely.
    expect(frames).toContain('box-shadow:0 0 2px 0 rgba(245,158,11,.4);box-shadow:0 0 2px 0 color-mix(in srgb,var(--dus-update-color)')
    expect(frames).toContain('box-shadow:0 0 7px 2px rgba(245,158,11,.72);box-shadow:0 0 7px 2px color-mix(in srgb,var(--dus-update-color)')
    expect(frames.match(/rgba\(245,158,11/g)?.length).toBe(2)
    expect(frames.match(/color-mix\(in srgb,var\(--dus-update-color\)/g)?.length).toBe(2)
  })

  it('keeps the amber glow when a re-check runs on a known update', () => {
    // Both attributes are set while refreshing with an update already known;
    // equal specificity means the later rule wins, so the update rule must be last.
    expect(CSS.indexOf('.dus-dot[data-update=true]{')).toBeGreaterThan(CSS.indexOf('.dus-dot[data-loading=true]{'))
  })

  it('holds the glow still under prefers-reduced-motion', () => {
    const reduced = line('@media (prefers-reduced-motion:reduce)')
    expect(reduced).toContain('.dus-dot[data-update=true]')
    expect(reduced).toContain('animation:none')
    expect(reduced).toContain('box-shadow:')
  })
})
