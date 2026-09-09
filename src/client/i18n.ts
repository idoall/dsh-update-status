/** Tiny bilingual dictionary kept local to avoid changing the host locale tree. */

export type Language = 'zh' | 'en'

type Entry = { zh: string; en: string }

const DICTIONARY: Record<string, Entry> = {
  'brand.status': { zh: 'DSH 版本状态', en: 'DSH version status' },
  'brand.checking': { zh: '正在检查版本', en: 'Checking version' },
  'brand.update': { zh: '有可用更新', en: 'Update available' },
  'brand.current': { zh: '已是最新或尚未发现更新', en: 'Up to date or no update found' },
  'brand.problem': { zh: '检查遇到问题', en: 'Check encountered a problem' },
  'footer.status': { zh: '打开 DSH 版本状态', en: 'Open DSH version status' },
  'panel.title': { zh: 'DSH 更新状态', en: 'DSH update status' },
  'panel.close': { zh: '关闭', en: 'Close' },
  'panel.current': { zh: '当前运行版本', en: 'Current running version' },
  'panel.latest': { zh: '所选通道版本', en: 'Selected channel version' },
  'panel.channels': { zh: '可用发布通道', en: 'Available release channels' },
  'panel.compatVerified': { zh: '已验证兼容', en: 'Verified compatible' },
  'panel.compatUnverified': { zh: '尚未验证兼容', en: 'Compatibility unverified' },
  'panel.compatIncompatible': { zh: '已知不兼容', en: 'Known incompatible' },
  'panel.selectChannel': { zh: '选择此通道', en: 'Select channel' },
  'panel.selectedChannel': { zh: '已选择', en: 'Selected' },
  'panel.notChecked': { zh: '尚未取得', en: 'Not available yet' },
  'panel.available': { zh: '发现新版本', en: 'Update available' },
  'panel.currentState': { zh: '未发现可用更新', en: 'No update found' },
  'panel.cached': { zh: '来自 Host 缓存', en: 'From Host cache' },
  'panel.live': { zh: '刚从 npm registry 检查', en: 'Checked npm registry now' },
  'panel.checkedAt': { zh: '上次检查', en: 'Last checked' },
  'panel.publishedAt': { zh: '发布时间', en: 'Published' },
  'panel.check': { zh: '检查更新', en: 'Check for updates' },
  'panel.checking': { zh: '检查中…', en: 'Checking…' },
  'panel.switchingChannel': { zh: '正在切换通道…', en: 'Switching channel…' },
  'panel.releaseNotes': { zh: '发布说明', en: 'Release notes' },
  'panel.command': { zh: '升级命令', en: 'Upgrade command' },
  'panel.copy': { zh: '复制命令', en: 'Copy command' },
  'panel.copied': { zh: '已复制', en: 'Copied' },
  'panel.copyFallback': { zh: '浏览器未允许复制；已选中文本，请长按或复制。', en: 'Clipboard unavailable; the command is selected for long-press or copy.' },
  'panel.commandNote': { zh: '仅复制，不会执行。请在运行 DSH 的那台电脑的终端执行；完成后由你自行重启 DSH。', en: 'Copy only — nothing runs here. Execute it in a terminal on the computer running DSH, then restart DSH yourself.' },
  'panel.readOnly': { zh: '阶段 1 仅提示：本插件不会安装、重启、回滚或替换任何文件。', en: 'Phase 1 is advisory only: this plugin never installs, restarts, rolls back, or replaces files.' },
  'panel.error': { zh: '检查提示', en: 'Check notice' },
  'panel.static': { zh: '此连接只显示静态版本；请在运行 DSH 的本机打开侧栏查看完整更新信息。', en: 'This connection shows only the static version. Open the sidebar on the computer running DSH for full update details.' },
  'preview.open': { zh: '查看预览版升级方式', en: 'View preview upgrade instructions' },
  'preview.close': { zh: '收起升级说明', en: 'Hide upgrade instructions' },
  'preview.follow': { zh: '关注通道只影响检查结果，不代表已安装或已切换版本。', en: 'Following a channel only changes update checks, not the installed version.' },
  'preview.target': { zh: '目标版本', en: 'Target version' },
  'preview.risk': { zh: '预览版本可能不稳定，插件兼容性尚需确认。执行前请保存工作、备份配置并结束运行中的任务；安装后需手动重启 DSH。此页面不会安装或重启。', en: 'Preview builds may be unstable and plugin compatibility needs checking. Save work, back up configuration and finish active tasks before executing. Restart DSH manually afterwards. This page never installs or restarts.' },
  'preview.unavailable': { zh: '暂无可确认的预览目标，请先检查更新。', en: 'No confirmed preview target. Check for updates first.' },
  'preview.manual': { zh: '当前安装方式无法安全生成命令，请先确认安装来源；源码安装需按其构建说明操作。', en: 'Cannot safely generate a command for this installation. Confirm its source; source checkouts require their build instructions.' },
  'preview.same': { zh: '此目标与当前运行版本相同，无需重复安装。', en: 'This target is already running; no reinstall is needed.' },
  'settings.title': { zh: '版本与更新', en: 'Version & updates' },
  'settings.sidebar': { zh: '在侧栏显示版本状态入口', en: 'Show the version-status entry in the sidebar' },
  'settings.sidebarHint': { zh: '关闭后不再渲染品牌 Badge 和收起轨道兜底入口。不会执行或安排升级。', en: 'When off, the brand badge and collapsed-rail fallback are not rendered. No update is run or scheduled.' },
  'settings.channel': { zh: '关注发布通道', en: 'Release channel to follow' },
  'settings.channelLatest': { zh: '稳定版（latest，推荐）', en: 'Stable (latest, recommended)' },
  'settings.channelNext': { zh: '候选版（next）', en: 'Release candidate (next)' },
  'settings.channelAlpha': { zh: '预览版（alpha）', en: 'Preview (alpha)' },
  'settings.channelHint': { zh: '预览通道可能包含未稳定接口或插件兼容性变化。这里只检查并生成命令，不会安装。', en: 'Preview channels may contain unstable APIs or plugin compatibility changes. This only checks and generates a command; it never installs.' },
  'settings.readonly': { zh: '此连接的设置为只读；显示状态不受影响。', en: 'Settings are read-only on this connection; status display is unchanged.' },
}

export function languageOf(): Language {
  try {
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

export function t(key: keyof typeof DICTIONARY): string {
  const entry = DICTIONARY[key]
  if (entry === undefined) return key
  return entry[languageOf()] ?? entry.en
}
