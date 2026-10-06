/** Tiny bilingual dictionary kept local to avoid changing the host locale tree. */

import type { UpdateStatus, UpdateWarning } from '../shared/types.ts'

export type Language = 'zh' | 'en'

type Entry = { zh: string; en: string }

const DICTIONARY: Record<string, Entry> = {
  'brand.status': { zh: 'DSH 版本状态', en: 'DSH version status' },
  'brand.checking': { zh: '正在检查版本', en: 'Checking version' },
  'brand.update': { zh: '有可用更新', en: 'Update available' },
  'brand.current': { zh: '已是最新或尚未发现更新', en: 'Up to date or no update found' },
  'brand.problem': { zh: '检查遇到问题', en: 'Check encountered a problem' },
  'panel.title': { zh: 'DSH 更新状态', en: 'DSH update status' },
  'panel.close': { zh: '关闭', en: 'Close' },
  'panel.cacheDuration': { zh: '缓存时长', en: 'Cache duration' },
  'panel.minutes': { zh: '分钟', en: 'minutes' },
  'panel.cacheHint': { zh: '到期后在下次打开或读取状态时检查；不会后台轮询。点击“检查更新”会立即检查。', en: 'After expiry, DSH checks only on the next status read; there is no background polling. “Check for updates” checks immediately.' },
  'panel.cacheReadonly': { zh: '此连接的缓存设置为只读。', en: 'This connection’s cache setting is read-only.' },
  'panel.current': { zh: '当前运行版本', en: 'Current running version' },
  'panel.newer': { zh: '可更新至', en: 'Newer version available' },
  'panel.compatVerified': { zh: '已验证兼容', en: 'Verified compatible' },
  'panel.compatUnverified': { zh: '尚未验证兼容', en: 'Compatibility unverified' },
  'panel.compatIncompatible': { zh: '已知不兼容', en: 'Known incompatible' },
  'panel.notChecked': { zh: '尚未取得', en: 'Not available yet' },
  'panel.available': { zh: '发现新版本', en: 'Update available' },
  'panel.currentState': { zh: '已是最新', en: 'Up to date' },
  'panel.cached': { zh: '来自 Host 缓存', en: 'From Host cache' },
  'panel.live': { zh: '刚从 npm registry 检查', en: 'Checked npm registry now' },
  'panel.checkedAt': { zh: '上次检查', en: 'Last checked' },
  'panel.publishedAt': { zh: '发布时间', en: 'Published' },
  'panel.check': { zh: '检查更新', en: 'Check for updates' },
  'panel.checking': { zh: '检查中…', en: 'Checking…' },
  'panel.releaseNotes': { zh: '发布说明', en: 'Release notes' },
  'panel.command': { zh: '升级命令', en: 'Upgrade command' },
  'panel.copy': { zh: '复制命令', en: 'Copy command' },
  'panel.copied': { zh: '已复制', en: 'Copied' },
  'panel.copyFallback': { zh: '浏览器未允许复制；已选中文本，请长按或复制。', en: 'Clipboard unavailable; the command is selected for long-press or copy.' },
  'panel.commandNote': { zh: '仅复制，不会执行。请在运行 DSH 的那台电脑的终端执行；完成后由你自行重启 DSH。', en: 'Copy only — nothing runs here. Execute it in a terminal on the computer running DSH, then restart DSH yourself.' },
  'panel.readOnly': { zh: '阶段 1 仅提示：本插件不会安装、重启、回滚或替换任何文件。', en: 'Phase 1 is advisory only: this plugin never installs, restarts, rolls back, or replaces files.' },
  'panel.error': { zh: '检查提示', en: 'Check notice' },
  'warning.registryUnavailable': { zh: '无法检查 npm registry：{detail}', en: 'Unable to check the npm registry: {detail}' },
  'warning.versionIncomparable': { zh: '无法按 SemVer 比较当前版本 {currentVersion} 与线上版本 {latestVersion}。', en: 'Unable to compare the current version {currentVersion} with the published version {latestVersion} using SemVer.' },
  'warning.versionUnverified': { zh: '线上版本 {version} 尚未验证与本插件兼容。', en: 'Version {version} has not been verified as compatible with this plugin.' },
  'warning.staleSchemastery': { zh: '本插件解析到的 @deepseek-ai/schemastery（版本 {version}）来自 {path}，不是 DSH 自带的那份，偏好字段无法标记为 volatile。请删除该残留目录并重启 DSH：rm -rf {nodeModulesDir}', en: 'This plugin resolved @deepseek-ai/schemastery {version} from {path} instead of the copy DSH provides, so preference fields cannot be marked volatile. Remove the stale directory and restart DSH: rm -rf {nodeModulesDir}' },
  'warning.staleSchemasteryNoPath': { zh: '本插件解析到的 @deepseek-ai/schemastery（版本 {version}）来自 {path}，不是 DSH 自带的那份，偏好字段无法标记为 volatile。请删除该处残留的 @deepseek-ai/schemastery 目录并重启 DSH。', en: 'This plugin resolved @deepseek-ai/schemastery {version} from {path} instead of the copy DSH provides, so preference fields cannot be marked volatile. Remove the stale @deepseek-ai/schemastery directory there and restart DSH.' },
  'guidance.sourceCheckout': { zh: '请更新 DSH 源码 checkout、安装依赖并重新构建；本插件无法从 GUI 原地替换。', en: 'Update the DSH source checkout, install its dependencies, and rebuild it; this plugin cannot replace it in place from the GUI.' },
  'guidance.unknownInstall': { zh: '升级前请先确认 DSH 的安装方式；本插件无法代为执行升级。', en: 'Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you.' },
  'settings.title': { zh: '版本与更新', en: 'Version & updates' },
  'settings.sidebar': { zh: '在侧栏显示版本状态入口', en: 'Show the version-status entry in the sidebar' },
  'settings.sidebarHint': { zh: '关闭后不再渲染品牌行里的版本芯片，品牌行恢复为 DSH 官方内容。不会执行或安排升级。', en: 'When off, the version chip in the brand row is not rendered and the brand row falls back to DSH’s own content. No update is run or scheduled.' },
  'settings.readonly': { zh: '此连接的设置为只读；显示状态不受影响。', en: 'Settings are read-only on this connection; status display is unchanged.' },
}

export function languageOf(): Language {
  try {
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

export function t(key: keyof typeof DICTIONARY, params: Record<string, string> = {}, language: Language = languageOf()): string {
  const entry = DICTIONARY[key]
  if (entry === undefined) return key
  const template = entry[language] ?? entry.en
  return template.replace(/\{([A-Za-z]+)\}/g, (match, name: string) => params[name] ?? match)
}

export function warningText(warning: UpdateWarning, language: Language = languageOf()): string {
  switch (warning.code) {
    case 'registry-unavailable': return t('warning.registryUnavailable', { detail: warning.detail }, language)
    case 'version-incomparable': return t('warning.versionIncomparable', {
      currentVersion: warning.currentVersion,
      latestVersion: warning.latestVersion,
    }, language)
    case 'version-unverified': return t('warning.versionUnverified', { version: warning.version }, language)
    case 'stale-schemastery': {
      const params = { version: warning.version ?? '—', path: warning.path }
      // Only print a removal command when the Host could name the directory to
      // remove; the module path alone would make `rm -rf` delete a single file.
      return warning.nodeModulesDir === null
        ? t('warning.staleSchemasteryNoPath', params, language)
        : t('warning.staleSchemastery', { ...params, nodeModulesDir: warning.nodeModulesDir }, language)
    }
  }
}

/** Prefer structured warnings, but keep the Host string for mixed-version clients. */
export function localizedWarning(status: Pick<UpdateStatus, 'warning' | 'warnings'>, language: Language = languageOf()): string | null {
  const warnings = status.warnings ?? []
  return warnings.length === 0 ? status.warning : warnings.map(item => warningText(item, language)).join(' ')
}

export function localizedUpgradeGuidance(
  status: Pick<UpdateStatus, 'installKind' | 'upgradeCommand'>,
  language: Language = languageOf(),
): string {
  if (status.installKind === 'source-checkout') return t('guidance.sourceCheckout', {}, language)
  if (status.installKind === 'unknown') return t('guidance.unknownInstall', {}, language)
  return status.upgradeCommand
}
