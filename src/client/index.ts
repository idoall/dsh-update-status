/**
 * DSH Web client half. It shadows only `sidebar.brand.name` with a compact
 * name + version chip that fits the 24px brand row and leaves the official fish
 * (`sidebar.brand.mark`) untouched. The detail panel is an additive
 * `shell.overlay`, never a chat-area floating widget.
 *
 * Deliberately NO `sidebar.footer.action` entry. DSH renders that list in one
 * row directly above `sidebar.settings`, and the collapsed rail's content box is
 * only 36px wide (the 56px column minus its 10px inline padding) — room for the
 * single official action. A second registrant makes that shared, centred row
 * overflow: on a phone it pushed the neighbouring plugin's entry off the screen
 * edge and parked our own dot on the rail's border. The chip in the expanded
 * brand row is the entry, so a collapsed sidebar carries none.
 *
 * The status read and the detail panel are NOT restricted to a loopback page.
 * DSH disables Host settings *persistence* on a non-loopback page, but the
 * Connection RPC stays authenticated and reachable there — see
 * settings/settingsChannel.ts for the one place the loopback distinction still
 * matters.
 *
 * Preferences live in the Host-side `dsh-update-status` settings entry — the
 * plugin's own Loader entry, whose volatile `Config` fields DSH 0.1.7 projects
 * as that entry's form. Two client channels can serve it: the official
 * `ctx.configForms.get(entryId)` form (the successor of the removed
 * `settingsScope` service) and, on the non-loopback pages where that form is
 * deliberately inert, a direct Host channel over `remote.settings`. See
 * settingsChannel.ts.
 */

import type { ClientContext, ConnectionClient } from './contract.ts'
import { BrandName, type SharedUi, UpdatePanel, UpdateSettings } from './components.tsx'
import { SETTINGS_NAMESPACE, PanelStore, PreferencesStore, StatusStore } from './stores.ts'
import { configFormScope, configFormsOf } from './settings/configFormScope.ts'
import {
  createHostDirectScope,
  settingsInvalidationsOf,
  settingsRemoteFace,
  settingsRemoteOf,
  type SettingsRemoteLike,
} from './settings/hostDirectScope.ts'
import { createSettingsChannel } from './settings/settingsChannel.ts'
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
  const status = new StatusStore(connection)
  const preferences = new PreferencesStore()
  const panel = new PanelStore()
  const ui: SharedUi = { status, preferences, panel }

  const disposers: Array<() => void> = []
  let stopped = false
  /** Own a subscription raised from an injection callback; release after teardown at once. */
  const own = (dispose: unknown): void => {
    if (typeof dispose !== 'function') return
    if (stopped) {
      try {
        (dispose as () => void)()
      } catch {
        // Contained.
      }
      return
    }
    disposers.push(dispose as () => void)
  }

  // The plugin's ONE storage contract is the Host settings entry
  // `dsh-update-status` (the plugin's own Loader entry id), but two client
  // channels can serve it: the official `configForms` form (loopback pages) and
  // — only when that form reports the documented non-loopback degradation — a
  // direct Host channel over the same public Remote. A LAN page is exactly that
  // non-loopback case; without the direct channel every preference silently
  // falls back to its default there. See settingsChannel.ts.
  let remoteSettings: SettingsRemoteLike | undefined
  /** Resolve the direct channel's Remote face; `ctx.get` covers a payload we could not read. */
  const directRemote = (): SettingsRemoteLike | undefined => {
    if (remoteSettings !== undefined) return remoteSettings
    try {
      remoteSettings = settingsRemoteFace(ctx.get('remote.settings'))
    } catch {
      // The dotted service key is not readable on this context.
    }
    return remoteSettings
  }
  const channel = createSettingsChannel({
    openDirect: () => {
      const remote = directRemote()
      return remote === undefined ? undefined : createHostDirectScope(remote, SETTINGS_NAMESPACE)
    },
  })

  ctx.effect(() => {
    const disposeStyles = installStyles()
    const detach = preferences.attach(channel)
    // Changing cache policy deliberately does not issue a network request. Its
    // value is sent on the next ordinary status read or manual check.
    let selected = status.getSnapshot().status?.channel ?? 'latest'
    const syncPreferences = () => {
      const next = preferences.getSnapshot()
      if (next.channel !== selected) {
        selected = next.channel
        void status.selectChannel(selected, next.cacheTtlMinutes)
      }
    }
    syncPreferences()
    const unsubscribe = preferences.subscribe(syncPreferences)
    // Every mount reads the Host's cached status, whichever page it is on; the
    // transport is authenticated and the Host route is the plugin's own.
    void status.load(preferences.getSnapshot().cacheTtlMinutes)
    return () => {
      stopped = true
      unsubscribe()
      detach()
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // Contained.
        }
      }
      channel.dispose()
      status.stop()
      disposeStyles()
    }
  }, 'dsh-update-status: styles, settings channel and first status read')

  // Official seam first: it stays authoritative whenever it is not `unavailable`,
  // so a loopback page keeps the official semantics (one shared describe mirror,
  // the official write queue) and pays no extra wire read. DSH 0.1.7 replaced
  // the per-namespace `settingsScope` service with these entry-addressed forms,
  // keyed by the Loader entry id the Host Config half owns (SETTINGS_NAMESPACE).
  try {
    ctx.inject(['configForms'], (raw: unknown) => {
      try {
        const forms = configFormsOf(raw)
        if (forms === undefined) return
        channel.setOfficial(configFormScope(forms.get<unknown>(SETTINGS_NAMESPACE)))
      } catch {
        // Unreadable settings seam: the preferences stay on their defaults.
      }
    })
  } catch {
    // No configForms seam on this host: the direct channel is the only hope.
  }

  // Direct Host channel. The Remote service can arrive before or after the
  // official scope, so `refresh()` re-evaluates the selection either way; the
  // document invalidation keeps this page in step with edits made elsewhere,
  // and a reconnect retries a read that was refused.
  //
  // Every read here is contained: the injected payload intentionally refuses the
  // dotted PARENT (`payload.remote` throws "cannot get property … without
  // inject"), so one unreadable member must never abort the whole wiring.
  try {
    ctx.inject(['remote.settings'], (raw: unknown) => {
      try {
        remoteSettings = settingsRemoteOf(raw) ?? remoteSettings
        channel.refresh()
        const invalidations = settingsInvalidationsOf(ctx.get('remote'))
        if (invalidations !== undefined) own(invalidations(() => channel.reload()))
      } catch {
        // No usable Remote seam: the direct channel stays closed and the official
        // scope keeps its verdict.
      }
    })
  } catch {
    // No Remote seam: non-loopback pages keep the honest unavailable state.
  }
  if (typeof ctx.on === 'function') {
    try {
      own(ctx.on('connection/reset', () => channel.reload()))
    } catch {
      // No lifecycle event seam on this host.
    }
  }

  // Single slot: a compact name + version chip shadows the official wordmark
  // (priority 0). Lowest priority renders; never touch sidebar.brand.mark.
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    { name: 'sidebar.brand.name', priority: -10 },
    () => BrandName({ ui }),
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
