/** Sidebar chip and overlay detail panel. */

import type * as ReactNS from 'react'
import { isChipProblem, visualState } from '../shared/visual-state.ts'
import { MAX_CACHE_TTL_MINUTES, MIN_CACHE_TTL_MINUTES, isCacheTtlMinutes, type ReleaseCandidate, type UpdateStatus } from '../shared/types.ts'
import type { PreferencesStore, PanelStore, RestartStore, StatusStore } from './stores.ts'
import { languageOf, localizedUpgradeGuidance, localizedWarning, t, type Language } from './i18n.ts'
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
  restart: RestartStore
}

/** Occupies ONLY sidebar.brand.name; the official fish mark stays untouched. */
export function BrandName({ ui }: { ui: SharedUi }): ReactNS.ReactElement | null {
  const preferences = useObservable(ui.preferences)
  const snapshot = useObservable(ui.status)
  // Defence in depth only: the entry that renders this component is already
  // disposed while the preference is off, because a single slot arbitrates by
  // priority and returning null would keep occupying the cell. See
  // client/index.ts — that disposal is what brings the official brand back.
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

function restartUnavailableText(reason: 'not-supervised' | 'desktop' | 'supervisor-mismatch' | 'supervisor-thrashing' | 'activity-unavailable' | 'timer-unavailable' | 'stale-instance' | null | undefined): string {
  if (reason === 'desktop') return t('restart.unavailableDesktop')
  if (reason === 'supervisor-mismatch') return t('restart.unavailableMismatch')
  if (reason === 'supervisor-thrashing') return t('restart.unavailableThrashing')
  if (reason === 'activity-unavailable') return t('restart.unavailableActivity')
  if (reason === 'timer-unavailable') return t('restart.unavailableTimer')
  if (reason === 'stale-instance') return t('restart.unavailableStale')
  return t('restart.unavailable')
}

function RestartControl({ restart }: { restart: RestartStore }): ReactNS.ReactElement {
  const snapshot = useObservable(restart)
  React.useEffect(() => { void restart.refresh() }, [restart])
  const unavailable = snapshot.status !== null && !snapshot.status.available
  const hasActivity = snapshot.activity.length > 0
  // Recovery steps only make sense for a lost supervision, which is exactly when
  // the Host attaches them; the other refusals say what to do in their own text.
  const recoverable = snapshot.status?.recovery?.commands ?? null
  const waiting = snapshot.phase === 'waiting'
  const label = snapshot.phase === 'unknown' ? t('restart.loading')
    : snapshot.phase === 'checking' ? t('restart.checking')
      : snapshot.phase === 'armed' ? (hasActivity ? t('restart.force') : t('restart.confirm'))
        : waiting ? t('restart.waitingShort')
          : snapshot.phase === 'timeout' ? t('restart.retry')
            : snapshot.phase === 'error' ? t('restart.retry')
              : t('restart.button')
  const disabled = snapshot.phase === 'unknown' || snapshot.phase === 'checking' || waiting || unavailable
  const click = (): void => {
    if (snapshot.phase === 'armed') { void restart.request(hasActivity); return }
    if (snapshot.phase === 'timeout' || snapshot.phase === 'error') { void restart.check(); return }
    void restart.check()
  }
  return <>
    <button
      className="dus-action dus-restart"
      type="button"
      disabled={disabled}
      title={unavailable ? restartUnavailableText(snapshot.status?.unavailableReason) : t('restart.title')}
      onClick={click}
    >{label}</button>
    {snapshot.phase === 'armed' && <button className="dus-action" type="button" onClick={() => restart.cancel()}>{t('restart.cancel')}</button>}
    {unavailable && <p className="dus-restart-message" role="status">{restartUnavailableText(snapshot.status?.unavailableReason)}</p>}
    {unavailable && recoverable !== null && <div className="dus-restart-recover">
      <p className="dus-restart-message">{t('restart.recoverIntro')}</p>
      <CommandBlock command={recoverable} label={t('restart.recoverLabel')} note={t('restart.recoverNote')} />
    </div>}
    {unavailable && snapshot.status?.unavailableReason === 'not-supervised' && <p className="dus-restart-message">{t('restart.recoverInstall')}</p>}
    {snapshot.phase === 'armed' && <p className="dus-restart-message" role="status">
      {hasActivity ? t('restart.activeWarning', { count: String(snapshot.activity.length) }) : t('restart.confirmHint')}
    </p>}
    {hasActivity && snapshot.phase === 'armed' && <ul className="dus-restart-work">{snapshot.activity.map(item => <li key={`${item.type}:${item.id}`}>{item.label} · {item.status}</li>)}</ul>}
    {waiting && <p className="dus-restart-message" role="status">{t('restart.waiting', { seconds: String(Math.floor(snapshot.elapsedMs / 1000)) })}</p>}
    {snapshot.phase === 'timeout' && <p className="dus-restart-message" role="alert">{t('restart.timeout')}</p>}
    {snapshot.phase === 'error' && snapshot.error !== null && <p className="dus-restart-message" role="alert">{snapshot.error}</p>}
  </>
}

function statusSummary(status: UpdateStatus | null, loading: boolean, error: string | null): { kind: 'update' | 'ok' | 'warning' | 'error'; text: string } {
  if (loading && status === null) return { kind: 'warning', text: t('brand.checking') }
  if (error !== null) return { kind: 'error', text: error }
  if (status !== null && status.releases.length > 0) {
    // The count is the whole answer: the cards below name every version, so the
    // state line does not repeat one of them and go stale when the list changes.
    return { kind: 'update', text: t('panel.updatesFound', { count: String(status.releases.length) }) }
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
 * One copy-only command and its own feedback.
 *
 * Each instance owns its clipboard state, so a card's "已复制" never appears on
 * another card: the panel can show several commands at once.
 */
function CopyableCommand({ command, disabled, label }: { command: string; disabled: boolean; label: string | null }): ReactNS.ReactElement {
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
      {label !== null && <p className="dus-command-label">{label}</p>}
      <code ref={commandRef} className="dus-command" tabIndex={0}>{command}</code>
      <div className="dus-actions dus-command-actions">
        <button className="dus-action" type="button" disabled={disabled} onClick={() => { void copy() }}>{t('panel.copy')}</button>
        {copyMessage !== null && <p className="dus-copy-message" role="status">{copyMessage}</p>}
      </div>
    </>
  )
}

/** A labelled, copy-only command block, used by restart recovery. */
function CommandBlock({ command, disabled = false, label = t('panel.command'), note = t('panel.commandNote') }: { command: string; disabled?: boolean; label?: string; note?: string }): ReactNS.ReactElement {
  return (
    <>
      <CopyableCommand command={command} disabled={disabled} label={label} />
      <p className="dus-note">{note}</p>
    </>
  )
}

/** One card, in the order the Host sent it, with "newest" already decided. */
export interface ReleaseRow {
  release: ReleaseCandidate
  /** Only ever true for the first row: the amber border and the 最新 pill. */
  newest: boolean
}

export interface ReleaseView {
  rows: ReleaseRow[]
  /** Some card carries a real command, so the copy-only note belongs on the panel. */
  copyable: boolean
  /** One explanation for an installation no candidate can hand a command to. */
  guidance: string | null
}

/**
 * What the card area renders, decided as a pure function.
 *
 * It lives outside the JSX for the same reason `visualState` does: "nothing newer
 * means no card and no command block at all" is a rule that regressions hide
 * from, and a test can drive this directly without a DOM. The Host's array is
 * already newest-first, so the client never re-sorts it — it only marks index 0.
 */
export function releaseViewOf(status: UpdateStatus | null, language: Language = languageOf()): ReleaseView {
  const releases = status === null ? [] : status.releases
  const copyable = releases.some(release => release.command !== null)
  return {
    rows: releases.map((release, index) => ({ release, newest: index === 0 })),
    copyable,
    guidance: status !== null && releases.length > 0 && !copyable
      ? localizedUpgradeGuidance(status.installKind, language)
      : null,
  }
}

/**
 * One upgradable version, top to bottom: what it is, when it shipped, and how to
 * get it. `newest` is index 0 of the Host's array — the list arrives sorted, and
 * the client must not re-sort a contract the Host already ordered.
 */
function ReleaseCard({ release, newest, disabled }: { release: ReleaseCandidate; newest: boolean; disabled: boolean }): ReactNS.ReactElement {
  const published = timeText(release.publishedAt)
  return (
    <article className="dus-release" data-highlight={newest || undefined}>
      <div className="dus-release-head">
        <code className="dus-release-version">{release.version}</code>
        {newest && <span className="dus-pill dus-pill-latest">{t('panel.latest')}</span>}
        {release.tag !== null && <span className="dus-pill">{release.tag}</span>}
      </div>
      <p className="dus-release-meta">
        <span className="dus-release-line">{release.line}</span>
        {published !== null && <span>{t('panel.publishedAt')}: {published}</span>}
      </p>
      {/* A source checkout has no command this panel may fabricate; the panel's
          guidance line speaks for every such card instead. */}
      {release.command !== null && <CopyableCommand command={release.command} disabled={disabled} label={null} />}
    </article>
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
  const view = releaseViewOf(status)

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
          <RestartControl restart={ui.restart} />
        </div>

        {view.rows.length > 0 && <div className="dus-releases">
          {view.rows.map(row => (
            <ReleaseCard key={row.release.version} release={row.release} newest={row.newest} disabled={snapshot.loading} />
          ))}
        </div>}
        {view.copyable && <p className="dus-note">{t('panel.commandNote')}</p>}
        {view.guidance !== null && <p className="dus-guidance">{view.guidance}</p>}
        <p className="dus-note">{t('panel.readOnly')}</p>
      </section>
    </dialog>
  )
}
