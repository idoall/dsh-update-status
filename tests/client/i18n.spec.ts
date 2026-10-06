import { describe, expect, it } from 'vitest'
import { localizedUpgradeGuidance, localizedWarning, warningText } from '../../src/client/i18n.ts'
import type { UpdateWarning } from '../../src/shared/types.ts'

const unverifiedWarning: UpdateWarning = {
  code: 'version-unverified',
  version: '0.2.1-alpha.1',
}

describe('runtime message localization', () => {
  it('renders structured Host warnings in English', () => {
    expect(warningText(unverifiedWarning, 'en')).toBe(
      'Version 0.2.1-alpha.1 has not been verified as compatible with this plugin.',
    )
    expect(warningText({ code: 'registry-unavailable', detail: 'offline' }, 'en')).toBe(
      'Unable to check the npm registry: offline',
    )
    expect(warningText({ code: 'version-incomparable', currentVersion: 'nightly', latestVersion: '0.2.1-alpha.1' }, 'en')).toBe(
      'Unable to compare the current version nightly with the published version 0.2.1-alpha.1 using SemVer.',
    )
  })

  it('renders the same Host warnings in Chinese', () => {
    expect(warningText(unverifiedWarning, 'zh')).toBe(
      '线上版本 0.2.1-alpha.1 尚未验证与本插件兼容。',
    )
    expect(warningText({ code: 'registry-unavailable', detail: 'offline' }, 'zh')).toBe(
      '无法检查 npm registry：offline',
    )
    expect(warningText({ code: 'version-incomparable', currentVersion: 'nightly', latestVersion: '0.2.1-alpha.1' }, 'zh')).toBe(
      '无法按 SemVer 比较当前版本 nightly 与线上版本 0.2.1-alpha.1。',
    )
  })

  it('prefers structured warnings and falls back for an older Host', () => {
    expect(localizedWarning({ warning: 'legacy fallback', warnings: [unverifiedWarning] }, 'zh')).toContain('尚未验证')
    expect(localizedWarning({ warning: 'legacy fallback' }, 'zh')).toBe('legacy fallback')
  })

  it('renders the stale-schemastery warning with the directory to remove', () => {
    const stale: UpdateWarning = {
      code: 'stale-schemastery',
      version: '3.18.2',
      path: '/p/node_modules/@deepseek-ai/schemastery/lib/index.cjs',
      nodeModulesDir: '/p/node_modules',
    }
    expect(warningText(stale, 'en')).toContain('3.18.2')
    expect(warningText(stale, 'en')).toContain('rm -rf /p/node_modules')
    expect(warningText(stale, 'zh')).toContain('偏好字段无法标记为 volatile')
    expect(warningText(stale, 'zh')).toContain('rm -rf /p/node_modules')
    // An unreadable version and an unknown directory still produce a usable
    // sentence, and never a removal command aimed at a single module file.
    const unknown: UpdateWarning = { ...stale, version: null, nodeModulesDir: null }
    expect(warningText(unknown, 'en')).toContain(stale.path)
    expect(warningText(unknown, 'en')).not.toContain('rm -rf')
    expect(warningText(unknown, 'zh')).toContain('—')
    expect(warningText(unknown, 'zh')).not.toContain('rm -rf')
  })

  it('localizes non-command installation guidance without changing real commands', () => {
    expect(localizedUpgradeGuidance({ installKind: 'source-checkout', upgradeCommand: 'fallback' }, 'zh')).toContain('DSH 源码 checkout')
    expect(localizedUpgradeGuidance({ installKind: 'unknown', upgradeCommand: 'fallback' }, 'en')).toBe(
      'Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you.',
    )
    expect(localizedUpgradeGuidance({ installKind: 'npm-global', upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1' }, 'zh')).toBe(
      'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
    )
  })
})
