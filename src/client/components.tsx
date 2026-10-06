/** Sidebar chip, overlay detail panel, and settings page. */

import type * as ReactNS from 'react'
import { isChipProblem, visualState } from '../shared/visual-state.ts'
import { MAX_CACHE_TTL_MINUTES, MIN_CACHE_TTL_MINUTES, isCacheTtlMinutes, type ReleaseCompatibility, type UpdateStatus } from '../shared/types.ts'
import type { PreferencesStore, PanelStore, StatusStore } from './stores.ts'
import { localizedUpgradeGuidance, localizedWarning, t } from './i18n.ts'
import { React, h } from './react.ts'

function useObservable<T>(store: { subscribe(listener: () => void): () => void; getSnapshot(): T }): T {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

function timeText(value: string | null): string | null {
  if (value === null) return null
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

function shortVersion(value: string): string {
  if (value.length <= 16) return value
  return value.slice(0, 15) + '…'
}

function compatibilityLabel(value: ReleaseCompatibility): string {
  if (value === 'verified') return t('panel.compatVerified')
  if (value === 'incompatible') return t('panel.compatIncompatible')
  return t('panel.compatUnverified')
}

/** Persists a cache policy only; it never schedules a browser or Host timer. */
function CacheTtlControl({ preferences }: { preferences: PreferencesStore }): ReactNS.ReactElement {
  const snapshot = useObservable(preferences)
  const [draft, setDraft] = React.useState(String(snapshot.cacheTtlMinutes))
  React.useEffect(() => { setDraft(String(snapshot.cacheTtlMinutes)) }, [snapshot.cacheTtlMinutes])
  const save = (): void => {
    const value = Number(draft)
    if (isCacheTtlMinutes(value)) preferences.setCacheTtlMinutes(value)
    else setDraft(String(snapshot.cacheTtlMinutes))
  }
  return (
    <div className="dus-cache-setting">
      <label className="dus-cache-field">
        <span>{t('panel.cacheDuration')}</span>
        <span className="dus-cache-input-wrap">
          <input
            className="dus-cache-input"
            type="number"
            inputMode="numeric"
            min={MIN_CACHE_TTL_MINUTES}
            max={MAX_CACHE_TTL_MINUTES}
            step={1}
            value={draft}
            disabled={!snapshot.writable}
            aria-describedby="dus-cache-hint"
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.currentTarget.blur() }
              if (event.key === 'Escape') { setDraft(String(snapshot.cacheTtlMinutes)); event.currentTarget.blur() }
            }}
          />
          <span>{t('panel.minutes')}</span>
        </span>
      </label>
      <p className="dus-cache-hint" id="dus-cache-hint">{t('panel.cacheHint')}</p>
      {!snapshot.writable && <p className="dus-cache-hint">{t('panel.cacheReadonly')}</p>}
    </div>
  )
}

function badgeLabel(status: UpdateStatus | null, loading: boolean, error: string | null): string {
  const state = visualState(status, loading, error)
  if (state === 'loading') return t('brand.checking')
  if (state === 'update') return t('brand.update')
  if (state === 'problem') return t('brand.problem')
  return t('brand.current')
}

export interface SharedUi {
  status: StatusStore
  preferences: PreferencesStore
  panel: PanelStore
}

/** Occupies ONLY sidebar.brand.name; the official fish mark stays untouched. */
export function BrandName({ ui }: { ui: SharedUi }): ReactNS.ReactElement | null {
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  if (!preferences.sidebarEnabled) return null

  const state = visualState(snapshot.status, snapshot.loading, snapshot.error)
  const version = snapshot.status?.currentVersion ?? '—'
  const activate = (event: ReactNS.SyntheticEvent): void => {
    // The surrounding sidebar brand is an existing New Session <button>. This
    // non-button interaction prevents a nested button and stops its click.
    event.preventDefault()
    event.stopPropagation()
    // The official brand identity ancestor is aria-hidden. Do not leave focus
    // inside it while the modal dialog is open (Chrome otherwise warns).
    const target = event.currentTarget
    if (target instanceof HTMLElement) target.blur()
    ui.panel.toggle()
  }
  const onKeyDown = (event: ReactNS.KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    activate(event)
  }

  return (
    <span className="dus-brand-name">
      {/* No handler: clicking this still bubbles to the shell's New Session button. */}
      <span className="dus-brand-deepseek">DeepSeek</span>
      <span
        className="dus-badge"
        data-update={snapshot.status?.hasUpdate === true || undefined}
        data-error={state === 'problem' || undefined}
        role="button"
        tabIndex={0}
        aria-label={badgeLabel(snapshot.status, snapshot.loading, snapshot.error)}
        title={badgeLabel(snapshot.status, snapshot.loading, snapshot.error)}
        onClick={activate}
        onKeyDown={onKeyDown}
      >
        <span className="dus-badge-version">{shortVersion(version)}</span>
        {/* `data-state` drives the palette (green when up to date); `data-update`
            and `data-loading` remain the louder, state-specific rules. */}
        <span className="dus-dot" data-state={state} data-update={snapshot.status?.hasUpdate === true || undefined} data-loading={snapshot.loading || undefined} aria-hidden="true" />
      </span>
    </span>
  )
}

function statusSummary(status: UpdateStatus | null, loading: boolean, error: string | null): { kind: 'update' | 'ok' | 'warning' | 'error'; text: string } {
  if (loading && status === null) return { kind: 'warning', text: t('brand.checking') }
  if (error !== null) return { kind: 'error', text: error }
  if (status?.hasUpdate === true) {
    return { kind: 'update', text: `${t('panel.available')} · ${status.latestVersion ?? ''}`.trim() }
  }
  if (status !== null) {
    const warning = localizedWarning(status)
    if (warning !== null) return { kind: 'warning', text: warning }
  }
  return { kind: 'ok', text: t('panel.currentState') }
}

function selectCommand(element: HTMLElement | null): void {
  if (element === null) return
  try {
    const selection = window.getSelection()
    if (selection === null) return
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
    element.focus()
  } catch {
    // The command remains ordinary selectable text even when selection fails.
  }
}

/**
 * The one upgrade command plus its copy affordance, shared by the panel and the
 * settings section so both surfaces can never disagree about what to run.
 */
function CommandBlock({ command, disabled = false }: { command: string; disabled?: boolean }): ReactNS.ReactElement {
  const commandRef = React.useRef<HTMLElement | null>(null)
  const [copyMessage, setCopyMessage] = React.useState<string | null>(null)
  const copy = async (): Promise<void> => {
    setCopyMessage(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(command)
      setCopyMessage(t('panel.copied'))
    } catch {
      selectCommand(commandRef.current)
      setCopyMessage(t('panel.copyFallback'))
    }
  }
  return (
    <>
      <p className="dus-command-label">{t('panel.command')}</p>
      <code ref={commandRef} className="dus-command" tabIndex={0}>{command}</code>
      <div className="dus-actions dus-command-actions">
        <button className="dus-action" type="button" disabled={disabled} onClick={() => { void copy() }}>{t('panel.copy')}</button>
        {copyMessage !== null && <p className="dus-copy-message" role="status">{copyMessage}</p>}
      </div>
      <p className="dus-note">{t('panel.commandNote')}</p>
    </>
  )
}

/** Full detail from whichever page the operator is on (the transport is authenticated). */
export function UpdatePanel({ ui }: { ui: SharedUi }): ReactNS.ReactElement | null {
  const panel = useObservable(ui.panel)
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  const dialogRef = React.useRef<HTMLDialogElement | null>(null)
  const visible = panel.open && preferences.sidebarEnabled

  React.useLayoutEffect(() => {
    if (!visible) return undefined
    const dialog = dialogRef.current
    if (dialog === null) return undefined
    try {
      if (!dialog.open) dialog.showModal()
    } catch {
      // Older embedded Chromium still receives a visible non-top-layer dialog.
      dialog.setAttribute('open', '')
    }
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [visible])

  React.useEffect(() => {
    if (!panel.open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') ui.panel.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [panel.open, ui.panel])

  if (!visible) return null
  const status = snapshot.status
  const warning = status === null ? null : localizedWarning(status)
  const summary = statusSummary(status, snapshot.loading, snapshot.error)
  const hasUpdate = status?.hasUpdate === true && status.latestVersion !== null
  const command = status === null || !hasUpdate ? '' : localizedUpgradeGuidance(status)

  return (
    <dialog
      ref={dialogRef}
      className="dus-overlay-root"
      aria-label={t('panel.title')}
      onCancel={(event) => {
        event.preventDefault()
        ui.panel.close()
      }}
    >
      <div className="dus-backdrop" onClick={() => { ui.panel.close() }} />
      <section className="dus-panel" role="dialog" aria-modal="true" aria-label={t('panel.title')} onClick={(event) => { event.stopPropagation() }}>
        <div className="dus-panel-head">
          <span className="dus-panel-title">{t('panel.title')}</span>
          <button className="dus-close" type="button" aria-label={t('panel.close')} onClick={() => { ui.panel.close() }}>×</button>
        </div>

        <CacheTtlControl preferences={ui.preferences} />
        <p className="dus-state" data-kind={summary.kind}>{summary.text}</p>

        <div className="dus-metadata">
          <div className="dus-metadata-row">
            <span className="dus-meta-label">{t('panel.current')}</span>
            <code className="dus-meta-value">{status?.currentVersion ?? '…'}</code>
          </div>
          {hasUpdate && <div className="dus-metadata-row">
            <span className="dus-meta-label">{t('panel.newer')}</span>
            <code className="dus-meta-value">{status.latestVersion}</code>
            {status.publishedAt !== null && <span className="dus-meta-sub">{t('panel.publishedAt')}: {timeText(status.publishedAt)}</span>}
            <span className="dus-meta-sub dus-compat" data-compatibility={status.compatibility}>{compatibilityLabel(status.compatibility)}</span>
          </div>}
          {status?.checkedAt !== null && status?.checkedAt !== undefined && <div className="dus-metadata-row">
            <span className="dus-meta-label">{t('panel.checkedAt')}</span>
            <span className="dus-meta-value">{timeText(status.checkedAt)}</span>
            <span className="dus-meta-sub">{status.cached ? t('panel.cached') : t('panel.live')}</span>
          </div>}
        </div>

        {warning !== null && <p className="dus-warning">{t('panel.error')}: {warning}</p>}
        {snapshot.error !== null && <p className="dus-warning">{t('panel.error')}: {snapshot.error}</p>}

        <div className="dus-actions">
          <button className="dus-action" type="button" disabled={snapshot.loading} onClick={() => { void ui.status.refresh(preferences.cacheTtlMinutes) }}>
            {snapshot.loading ? t('panel.checking') : t('panel.check')}
          </button>
          {status !== null && <a className="dus-action" href={status.changelogUrl} target="_blank" rel="noreferrer">{t('panel.releaseNotes')}</a>}
        </div>

        {hasUpdate && <CommandBlock command={command} disabled={snapshot.loading} />}
        <p className="dus-note">{t('panel.readOnly')}</p>
      </section>
    </dialog>
  )
}

/** Separate setting page: disables only this plugin's own rendering. */
export function UpdateSettings({ ui }: { ui: SharedUi }): ReactNS.ReactElement {
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  const status = snapshot.status
  const summary = statusSummary(status, snapshot.loading, snapshot.error)
  const hasUpdate = status?.hasUpdate === true && status.latestVersion !== null
  const command = status === null || !hasUpdate ? '' : localizedUpgradeGuidance(status)
  return (
    <section className="dus-settings">
      <h2 className="dus-settings-heading">{t('settings.title')}</h2>
      <div className="dus-settings-card">
        <label className="dus-settings-toggle">
          <input
            type="checkbox"
            checked={preferences.sidebarEnabled}
            disabled={!preferences.writable}
            onChange={(event) => { ui.preferences.setSidebarEnabled(event.currentTarget.checked) }}
          />
          <span>{t('settings.sidebar')}</span>
        </label>
        <p className="dus-settings-hint">{t('settings.sidebarHint')}</p>
        {!preferences.writable && <p className="dus-settings-hint">{t('settings.readonly')}</p>}
      </div>
      <div className="dus-settings-card">
        <p className="dus-settings-hint">{t('panel.current')}: <code>{status?.currentVersion ?? '…'}</code></p>
        <p className="dus-state" data-kind={summary.kind}>{summary.text}</p>
        {hasUpdate && <p className="dus-settings-hint">{t('panel.newer')}: <code>{status.latestVersion}</code> · <span className="dus-compat" data-compatibility={status.compatibility}>{compatibilityLabel(status.compatibility)}</span></p>}
        {snapshot.error !== null && <p role="alert">{snapshot.error}</p>}
        {hasUpdate && <CommandBlock command={command} disabled={snapshot.loading} />}
        <div className="dus-actions">
          <button className="dus-action" type="button" disabled={snapshot.loading} onClick={() => { void ui.status.refresh(preferences.cacheTtlMinutes) }}>
            {snapshot.loading ? t('panel.checking') : t('panel.check')}
          </button>
          {status !== null && <a className="dus-action" href={status.changelogUrl} target="_blank" rel="noreferrer">{t('panel.releaseNotes')}</a>}
        </div>
      </div>
    </section>
  )
}
