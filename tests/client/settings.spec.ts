/**
 * Settings-section rendering guard.
 *
 * The repository deliberately has no `react-dom` dependency — DSH supplies the
 * renderer to the client bundle — so this spec calls the real component and walks
 * the element tree it returns. That is enough to lock the wiring the settings page
 * depends on: the *Version & updates* card must show when the supervised DSH Web
 * process started, and must not invent a time when an older Host omits it.
 *
 * `useObservable` is the component's only hook, so it is stubbed directly rather
 * than pulling in a renderer; every other hook in the file belongs to components
 * this spec never invokes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { React } from '../../src/client/react.ts'
import { UpdateSettings } from '../../src/client/components.tsx'
import { t } from '../../src/client/i18n.ts'
import type { SharedUi } from '../../src/client/components.tsx'

interface ElementLike {
  readonly type: unknown
  readonly props: Record<string, unknown> | null
}

function ui(options: { startedAt?: string; status?: Record<string, unknown> } = {}): SharedUi {
  const { startedAt, status: overrides } = options
  const preferences = {
    getSnapshot: () => ({ sidebarEnabled: true, cacheTtlMinutes: 360, writable: true, status: 'ready' as const }),
    subscribe: () => () => {},
  }
  const status = {
    getSnapshot: () => ({ status: null, loading: false, error: null }),
    subscribe: () => () => {},
  }
  const restart = {
    getSnapshot: () => ({
      phase: startedAt === undefined ? 'idle' as const : 'idle' as const,
      status: {
        instanceId: 'host-1', available: true, supervisor: 'launchd' as const, unavailableReason: null,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...overrides,
      },
      activity: [], elapsedMs: 0, error: null,
    }),
    subscribe: () => () => {},
    refresh: () => Promise.resolve(),
  }
  return {
    preferences, status, restart,
    panel: { getSnapshot: () => ({ open: false }), subscribe: () => () => {} },
  } as unknown as SharedUi
}

/**
 * Every string the tree renders, in document order.
 *
 * Function components are INVOKED, not merely collected: the restart control is a
 * component of its own and the chip panel and the settings card share it, so its
 * text (the refusal reason, the recovery steps) only exists once it is called.
 * Hooks are stubbed by the caller, which is why `render` patches the four the
 * tree reaches.
 */
function texts(node: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 40) return found
  if (typeof node === 'string') {
    found.push(node)
    return found
  }
  if (typeof node === 'number') {
    found.push(String(node))
    return found
  }
  if (node === null || node === undefined || typeof node === 'boolean') return found
  if (Array.isArray(node)) {
    for (const child of node) texts(child, found, depth + 1)
    return found
  }
  const element = node as ElementLike
  if (typeof element.type === 'function') {
    texts((element.type as (props: unknown) => unknown)(element.props ?? {}), found, depth + 1)
    return found
  }
  // Host elements contribute only their children; attributes are not text.
  if (element.props !== null) texts(element.props.children, found, depth + 1)
  return found
}

function findByClass(node: unknown, className: string): ElementLike | undefined {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByClass(child, className)
      if (found !== undefined) return found
    }
    return undefined
  }
  const element = node as ElementLike
  if (element.props?.className === className) return element
  for (const value of Object.values(element.props ?? {})) {
    const found = findByClass(value, className)
    if (found !== undefined) return found
  }
  return undefined
}

afterEach(() => { vi.restoreAllMocks() })

/** The hooks the invoked components reach for, without a renderer. */
function stubHooks(): void {
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe: unknown, getSnapshot: unknown) => (getSnapshot as () => unknown)())
  vi.spyOn(React, 'useEffect').mockImplementation(() => {})
  vi.spyOn(React, 'useLayoutEffect').mockImplementation(() => {})
  vi.spyOn(React, 'useRef').mockImplementation(() => ({ current: null }))
  // The catch-all hook stub: this spec only reads rendered text, so the setter
  // never runs, and the tuple shape is what React's own signature expects.
  vi.spyOn(React, 'useState').mockImplementation((((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    () => {},
  ]) as unknown) as typeof React.useState)
}

function render(startedAt?: string): string[] {
  stubHooks()
  return texts(UpdateSettings({ ui: ui({ startedAt }) }))
}

/** The same control is mounted by the chip panel and the settings card. */
function renderStatus(status: Record<string, unknown>): string[] {
  stubHooks()
  return texts(UpdateSettings({ ui: ui({ status }) }))
}

describe('settings section: service start time', () => {
  it('shows when the Host process started, formatted like the rest of the panel', () => {
    const startedAt = '2026-10-09T00:25:03.000Z'
    const rendered = render(startedAt)
    expect(rendered).toContain(t('settings.serviceStarted'))
    expect(rendered).toContain(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(startedAt)))
  })

  it('shares one row with the running version, version first', () => {
    // One element, so the CSS can put the version left and the start time right and
    // wrap the pair on a narrow card; two loose sibling paragraphs could not be laid
    // out as a single row without restructuring the card.
    stubHooks()
    const tree: unknown = UpdateSettings({ ui: ui({ startedAt: '2026-10-09T00:25:03.000Z' }) })
    const row = findByClass(tree, 'dus-settings-pair')
    expect(row).toBeDefined()
    const rowTexts = texts(row)
    expect(rowTexts).toContain(t('panel.current'))
    expect(rowTexts).toContain(t('settings.serviceStarted'))
    expect(rowTexts.indexOf(t('panel.current'))).toBeLessThan(rowTexts.indexOf(t('settings.serviceStarted')))
  })

  it('tells an operator how to get the button back when supervision was lost', () => {
    // The Host sends these steps from its own installer receipt; the panel must
    // show them, because a disabled button with no way forward is a dead end.
    const commands = 'lsof -nP -iTCP:3080 -sTCP:LISTEN\nlaunchctl kickstart -k gui/501/com.idoall.dsh-update-status.web'
    const rendered = renderStatus({
      available: false, unavailableReason: 'supervisor-mismatch', recovery: { commands },
    })
    expect(rendered).toContain(t('restart.unavailableMismatch'))
    expect(rendered).toContain(t('restart.recoverIntro'))
    expect(rendered).toContain(t('restart.recoverLabel'))
    expect(rendered).toContain(commands)
    expect(rendered).toContain(t('restart.recoverNote'))
  })

  it('points at the setup docs when nothing is supervising yet', () => {
    const rendered = renderStatus({ available: false, unavailableReason: 'not-supervised' })
    expect(rendered).toContain(t('restart.recoverInstall'))
    // No receipt exists, so there is nothing to copy — and nothing invented.
    expect(rendered).not.toContain(t('restart.recoverLabel'))
  })

  it('shows no recovery steps when the refusal needs none', () => {
    const rendered = renderStatus({ available: false, unavailableReason: 'activity-unavailable' })
    expect(rendered).toContain(t('restart.unavailableActivity'))
    expect(rendered).not.toContain(t('restart.recoverIntro'))
  })

  it('omits the line entirely on a Host that predates the field', () => {
    // A hot-reloaded bundle can meet an older Host; showing a placeholder or a
    // local guess would be worse than showing nothing.
    const rendered = render()
    expect(rendered).not.toContain(t('settings.serviceStarted'))
    // The row must keep rendering the version it has always shown.
    expect(rendered).toContain(t('panel.current'))
  })
})
