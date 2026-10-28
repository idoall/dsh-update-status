import { describe, expect, it } from 'vitest'
import { localizedUpgradeGuidance, localizedWarning, t, warningText } from '../../src/client/i18n.ts'
import type { UpdateWarning } from '../../src/shared/types.ts'

describe('runtime message localization', () => {
  it('renders structured Host warnings in English', () => {
    expect(warningText({ code: 'registry-unavailable', detail: 'offline' }, 'en')).toBe(
      'Unable to check the npm registry: offline',
    )
    expect(warningText({ code: 'version-incomparable', currentVersion: 'nightly', latestVersion: '0.2.1-alpha.1' }, 'en')).toBe(
      'Unable to compare the current version nightly with the published version 0.2.1-alpha.1 using SemVer.',
    )
  })

  it('renders the same Host warnings in Chinese', () => {
    expect(warningText({ code: 'registry-unavailable', detail: 'offline' }, 'zh')).toBe(
      '无法检查 npm registry：offline',
    )
    expect(warningText({ code: 'version-incomparable', currentVersion: 'nightly', latestVersion: '0.2.1-alpha.1' }, 'zh')).toBe(
      '无法按 SemVer 比较当前版本 nightly 与线上版本 0.2.1-alpha.1。',
    )
  })

  it('prefers structured warnings and falls back for an older Host', () => {
    const offline: UpdateWarning = { code: 'registry-unavailable', detail: 'offline' }
    expect(localizedWarning({ warning: 'legacy fallback', warnings: [offline] }, 'zh')).toBe('无法检查 npm registry：offline')
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
})

describe('0.5.0 panel copy', () => {
  it('counts the versions in the same sentence in both languages', () => {
    expect(t('panel.updatesFound', { count: '2' }, 'en')).toBe('2 newer version(s) available')
    expect(t('panel.updatesFound', { count: '2' }, 'zh')).toBe('发现 2 个可升级版本')
    // The placeholder is the only difference a caller supplies: neither language
    // may drop it, or the state line would stop naming the number of cards.
    expect(t('panel.updatesFound', {}, 'en')).toContain('{count}')
    expect(t('panel.updatesFound', {}, 'zh')).toContain('{count}')
  })

  it('labels the highest card in the operator’s language', () => {
    expect(t('panel.latest', {}, 'zh')).toBe('最新')
    expect(t('panel.latest', {}, 'en')).toBe('Newest')
    // The copy keys survive the compatibility removal unchanged.
    expect(t('panel.copy', {}, 'zh')).toBe('复制命令')
    expect(t('panel.copied', {}, 'en')).toBe('Copied')
    expect(t('panel.command', {}, 'en')).toBe('Upgrade command')
  })

  it('localizes non-command installation guidance and declines a command installation', () => {
    expect(localizedUpgradeGuidance('source-checkout', 'zh')).toContain('DSH 源码 checkout')
    expect(localizedUpgradeGuidance('unknown', 'en')).toBe(
      'Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you.',
    )
    // A package-manager installation carries a real command per candidate, so
    // guidance prose would only be noise under its card.
    expect(localizedUpgradeGuidance('npm-global', 'zh')).toBeNull()
    expect(localizedUpgradeGuidance('pnpm-global', 'en')).toBeNull()
  })
})
