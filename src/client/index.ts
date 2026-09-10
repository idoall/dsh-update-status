/**
 * DSH Web client half. It replaces only `sidebar.brand.name`, leaves the
 * official fish (`sidebar.brand.mark`) untouched, and adds a collapsed-rail
 * fallback at `sidebar.footer.action`. The detail panel is an additive
 * `shell.overlay`, never a chat-area floating widget.
 */

import type { ClientContext, ConnectionClient, SettingsScopeBinder } from './contract.ts'
import { BrandName, FooterAction, type SharedUi, UpdatePanel, UpdateSettings } from './components.tsx'
import { SETTINGS_NAMESPACE, PanelStore, PreferencesStore, StatusStore } from './stores.ts'
import { STATIC_COMPATIBLE_VERSION } from '../shared/types.ts'
import { t } from './i18n.ts'
import { UPDATE_STATUS_CSS } from './styles.ts'

const PLUGIN_ID = 'dsh-update-status'
const CSS_TAG_ID = `${PLUGIN_ID}/styles`

function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`)
  if (existing !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = UPDATE_STATUS_CSS
  document.head.appendChild(tag)
  return () => {
    const live = document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`)
    if (live?.parentNode !== undefined && live?.parentNode !== null) live.parentNode.removeChild(live)
  }
}

function connectionOf(ctx: ClientContext): ConnectionClient {
  try {
    const candidate = ctx.get('connection')
    return candidate !== null && typeof candidate === 'object' ? candidate as ConnectionClient : {}
  } catch {
    return {}
  }
}

function apply(ctx: ClientContext): void {
  const connection = connectionOf(ctx)
  // The authenticated transport can serve a remote browser too. Restrict the
  // metadata request and command panel to the machine running DSH; remote
  // clients deliberately render only the release this bundle is compatible with.
  const canManage = connection.isLoopback === true
  const status = new StatusStore(connection, canManage ? null : STATIC_COMPATIBLE_VERSION)
  const preferences = new PreferencesStore()
  const panel = new PanelStore()
  const ui: SharedUi = { status, preferences, panel, canManage }

  ctx.effect(() => {
    const disposeStyles = installStyles()
    if (canManage) void status.load(preferences.getSnapshot().cacheTtlMinutes)
    return () => {
      status.stop()
      disposeStyles()
    }
  }, 'dsh-update-status: style and first status read')

  // This is deliberately separate from the client module's hard injection:
  // a missing settings provider keeps the default visible state and does not
  // prevent the version badge or Host check from working.
  ctx.inject(['settingsScope'], (raw) => {
    const binder = (raw as { settingsScope?: unknown }).settingsScope
    if (binder === null || typeof binder !== 'object' || typeof (binder as SettingsScopeBinder).bind !== 'function') return
    try {
      const scope = (binder as SettingsScopeBinder).bind({ namespace: SETTINGS_NAMESPACE })
      ctx.effect(() => {
        const detach = preferences.attach(scope)
        let selected = status.getSnapshot().status?.channel ?? 'latest'
        const syncPreferences = () => {
          const next = preferences.getSnapshot()
          if (next.channel !== selected) {
            selected = next.channel
            void status.selectChannel(selected, next.cacheTtlMinutes)
          }
          // Changing cache policy deliberately does not issue a network request.
          // Its value is sent on the next ordinary status read or manual check.
        }
        syncPreferences()
        const unsubscribe = preferences.subscribe(syncPreferences)
        return () => { unsubscribe(); detach() }
      }, 'dsh-update-status: sidebar and channel preferences')
    } catch {
      // Default remains enabled when the Host settings namespace is unavailable.
    }
  })

  // single slot: DeepSeek + our badge replaces the complete official wordmark
  // (which contains HARNESS), but never touches sidebar.brand.mark.
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    // Official brand uses priority 0; the single-slot ledger requires a
    // different, lower priority to shadow it without mutating official code.
    { name: 'sidebar.brand.name', priority: -10 },
    () => BrandName({ ui }),
  ))

  // additive fallback; returns null in wide mode to avoid two visible badges.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'dsh-update-status', order: 40 },
    props => FooterAction({ wide: props.wide, ui }),
  ))

  // additive frame overlay for click/tap panel and narrow-view bottom sheet.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-update-status', order: 40 },
    () => UpdatePanel({ ui }),
  ))

  // Independent settings section provides the required way to hide our entry.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'dsh-update-status', order: 80, label: () => t('settings.title') },
    () => UpdateSettings({ ui }),
  ))
}

module.exports = {
  name: PLUGIN_ID,
  inject: ['slots', 'connection'],
  apply,
}
