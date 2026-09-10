/** Sidebar replacement, collapsed-rail fallback, overlay detail panel, and settings page. */

import type * as ReactNS from 'react'
import { visibleChannelReleases } from '../shared/channels.ts'
import { previewCommand } from '../shared/preview-guidance.ts'
import { MAX_CACHE_TTL_MINUTES, MIN_CACHE_TTL_MINUTES, isCacheTtlMinutes, type ReleaseChannel, type ReleaseCompatibility, type UpdateStatus } from '../shared/types.ts'
import type { PreferencesStore, PanelStore, StatusStore } from './stores.ts'
import { t } from './i18n.ts'
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

function channelLabel(channel: ReleaseChannel): string {
  if (channel === 'latest') return t('settings.channelLatest')
  if (channel === 'next') return t('settings.channelNext')
  return t('settings.channelAlpha')
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

type VisualState = 'loading' | 'update' | 'current' | 'problem'

function visualState(status: UpdateStatus | null, loading: boolean, error: string | null): VisualState {
  if (loading) return 'loading'
  if (error !== null || status?.warning !== null) return status?.hasUpdate === true ? 'update' : 'problem'
  return status?.hasUpdate === true ? 'update' : 'current'
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
  canManage: boolean
}

/** Occupies ONLY sidebar.brand.name; the official fish mark stays untouched. */
export function BrandName({ ui }: { ui: SharedUi }): ReactNS.ReactElement | null {
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  if (!preferences.sidebarEnabled) return null

  const state = visualState(snapshot.status, snapshot.loading, snapshot.error)
  const version = snapshot.status?.currentVersion ?? '…'
  const activate = (event: ReactNS.SyntheticEvent): void => {
    // The surrounding sidebar brand is an existing New Session <button>. This
    // non-button interaction prevents a nested button and stops its click.
    event.preventDefault()
    event.stopPropagation()
    // The official brand identity ancestor is aria-hidden. Do not leave focus
    // inside it while the modal dialog is open (Chrome otherwise warns).
    const target = event.currentTarget
    if (target instanceof HTMLElement) target.blur()
    if (ui.canManage) ui.panel.toggle('brand')
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
        role={ui.canManage ? 'button' : undefined}
        tabIndex={ui.canManage ? 0 : undefined}
        aria-label={badgeLabel(snapshot.status, snapshot.loading, snapshot.error)}
        aria-disabled={ui.canManage ? undefined : true}
        title={badgeLabel(snapshot.status, snapshot.loading, snapshot.error)}
        onClick={ui.canManage ? activate : undefined}
        onKeyDown={ui.canManage ? onKeyDown : undefined}
      >
        <span className="dus-badge-version">{shortVersion(version)}</span>
        <span className="dus-dot" data-update={snapshot.status?.hasUpdate === true || undefined} data-loading={snapshot.loading || undefined} aria-hidden="true" />
      </span>
    </span>
  )
}

/** List-slot fallback: it deliberately disappears while the name badge is wide. */
export function FooterAction({ wide, ui }: { wide?: unknown; ui: SharedUi }): ReactNS.ReactElement | null {
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  if (wide === true || !preferences.sidebarEnabled) return null
  const state = visualState(snapshot.status, snapshot.loading, snapshot.error)
  const label = badgeLabel(snapshot.status, snapshot.loading, snapshot.error)
  return (
    <button
      className="dus-footer-button"
      type="button"
      aria-label={t('footer.status')}
      title={label}
      disabled={!ui.canManage}
      onClick={() => { ui.panel.toggle('rail') }}
    >
      <span className="dus-footer-icon" aria-hidden="true">↟</span>
      <span className="dus-dot dus-footer-dot" data-update={snapshot.status?.hasUpdate === true || undefined} data-loading={state === 'loading' || undefined} />
    </button>
  )
}

function statusSummary(status: UpdateStatus | null, loading: boolean, error: string | null): { kind: 'update' | 'ok' | 'warning' | 'error'; text: string } {
  if (loading && status === null) return { kind: 'warning', text: t('brand.checking') }
  if (error !== null) return { kind: 'error', text: error }
  if (status?.hasUpdate === true) return { kind: 'update', text: t('panel.available') }
  if (status?.warning !== null && status?.warning !== undefined) return { kind: 'warning', text: status.warning }
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

/** Full detail is only opened from a loopback/local DSH UI surface. */
export function UpdatePanel({ ui }: { ui: SharedUi }): ReactNS.ReactElement | null {
  const panel = useObservable(ui.panel)
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  const commandRef = React.useRef<HTMLElement | null>(null)
  const dialogRef = React.useRef<HTMLDialogElement | null>(null)
  const [copyMessage, setCopyMessage] = React.useState<string | null>(null)
  const visible = panel.open && preferences.sidebarEnabled && ui.canManage

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
  const summary = statusSummary(status, snapshot.loading, snapshot.error)
  const switchingChannel = status !== null && status.channel !== preferences.channel
  const command = switchingChannel ? t('panel.switchingChannel') : status?.upgradeCommand ?? '—'

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
      <section className="dus-panel" data-origin={panel.origin} role="dialog" aria-modal="true" aria-label={t('panel.title')} onClick={(event) => { event.stopPropagation() }}>
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
          <div className="dus-metadata-row">
            <span className="dus-meta-label">{t('panel.latest')} · {status === null ? 'latest' : channelLabel(status.channel)}</span>
            <code className="dus-meta-value">{status?.latestVersion ?? t('panel.notChecked')}</code>
            {status?.publishedAt !== null && status?.publishedAt !== undefined && <span className="dus-meta-sub">{t('panel.publishedAt')}: {timeText(status.publishedAt)}</span>}
          </div>
          {status?.checkedAt !== null && status?.checkedAt !== undefined && <div className="dus-metadata-row">
            <span className="dus-meta-label">{t('panel.checkedAt')}</span>
            <span className="dus-meta-value">{timeText(status.checkedAt)}</span>
            <span className="dus-meta-sub">{status.cached ? t('panel.cached') : t('panel.live')}</span>
          </div>}
        </div>

        {status !== null && <div className="dus-channel-list" aria-label={t('panel.channels')}>
          <p className="dus-command-label">{t('panel.channels')}</p>
          {visibleChannelReleases(status).map(release => {
            const selected = release.channel === preferences.channel
            return <div className="dus-channel-row" data-selected={selected || undefined} key={release.channel}>
              <span>{channelLabel(release.channel)}</span>
              <code>{release.version ?? '—'}</code>
              <span className="dus-channel-compat" data-compatibility={release.compatibility}>{compatibilityLabel(release.compatibility)}</span>
              <button
                className="dus-channel-action"
                type="button"
                disabled={selected || !preferences.writable || release.version === null}
                aria-label={`${selected ? t('panel.selectedChannel') : t('panel.selectChannel')}: ${channelLabel(release.channel)}`}
                onClick={() => { ui.preferences.setChannel(release.channel) }}
              >{selected ? t('panel.selectedChannel') : t('panel.selectChannel')}</button>
            </div>
          })}
        </div>}

        {status?.warning !== null && status?.warning !== undefined && <p className="dus-warning">{t('panel.error')}: {status.warning}</p>}
        {snapshot.error !== null && <p className="dus-warning">{t('panel.error')}: {snapshot.error}</p>}

        <div className="dus-actions">
          <button className="dus-action" type="button" disabled={snapshot.loading} onClick={() => { void ui.status.refresh(undefined, preferences.cacheTtlMinutes) }}>
            {snapshot.loading ? t('panel.checking') : t('panel.check')}
          </button>
          {status !== null && <a className="dus-action" href={status.changelogUrl} target="_blank" rel="noreferrer">{t('panel.releaseNotes')}</a>}
          <button className="dus-action" type="button" disabled={switchingChannel || status === null} onClick={() => { void copy() }}>{t('panel.copy')}</button>
        </div>

        <p className="dus-command-label">{t('panel.command')}</p>
        <code ref={commandRef} className="dus-command" tabIndex={0}>{command}</code>
        {copyMessage !== null && <p className="dus-copy-message" role="status">{copyMessage}</p>}
        <p className="dus-note">{t('panel.commandNote')}</p>
        <p className="dus-note">{t('panel.readOnly')}</p>
      </section>
    </dialog>
  )
}

/** Separate setting page: disables only this plugin's own rendering. */
export function UpdateSettings({ ui }: { ui: SharedUi }): ReactNS.ReactElement {
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  const [showGuidance, setShowGuidance] = React.useState(false)
  const previews = snapshot.status?.channels.filter(release => release.channel !== 'latest') ?? []
  const channelOptions = snapshot.status === null
    ? [{ channel: preferences.channel }]
    : visibleChannelReleases(snapshot.status)
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
        <label className="dus-settings-field">
          <span>{t('settings.channel')}</span>
          <select
            className="dus-channel-select"
            value={preferences.channel}
            disabled={!preferences.writable}
            onChange={(event) => { ui.preferences.setChannel(event.currentTarget.value as ReleaseChannel) }}
          >
            {channelOptions.map(option => <option value={option.channel} key={option.channel}>{channelLabel(option.channel)}</option>)}
          </select>
        </label>
        <p className="dus-settings-hint">{t('settings.channelHint')}</p>
        <p className="dus-settings-hint">{t('panel.current')}: <code>{snapshot.status?.currentVersion ?? '…'}</code></p>
        <p className="dus-settings-hint">{t('preview.follow')}</p>
        {ui.canManage && <button className="dus-action" type="button" aria-expanded={showGuidance} onClick={() => { setShowGuidance(!showGuidance) }}>{t(showGuidance ? 'preview.close' : 'preview.open')}</button>}
        {ui.canManage && showGuidance && <section aria-label={t('preview.open')}>
          <p className="dus-warning">{t('preview.risk')}</p>
          <button className="dus-action" type="button" disabled={snapshot.loading} onClick={() => { void ui.status.refresh(undefined, preferences.cacheTtlMinutes) }}>{t(snapshot.loading ? 'panel.checking' : 'panel.check')}</button>
          {snapshot.error !== null && <p role="alert">{snapshot.error}</p>}
          {previews.length === 0 && <p>{t('preview.unavailable')}</p>}
          {previews.map(release => {
            const status = snapshot.status!
            const command = previewCommand(status, release.version)
            return <div className="dus-settings-card" key={release.channel}>
              <p>{channelLabel(release.channel)} · {t('preview.target')}: <code>{release.version ?? t('panel.notChecked')}</code></p>
              <p>{compatibilityLabel(release.compatibility)}</p>
              {release.version === null ? <p>{t('preview.unavailable')}</p> : release.version === status.currentVersion ? <p>{t('preview.same')}</p> : command !== null ? <><p>{t('panel.command')}</p><code className="dus-command" tabIndex={0}>{command}</code></> : <p>{t('preview.manual')}</p>}
            </div>
          })}
          <p className="dus-note">{t('panel.commandNote')}</p>
        </section>}
      </div>
    </section>
  )
}
