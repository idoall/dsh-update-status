import { describe, expect, it } from 'vitest'
import { localizedUpgradeGuidance, localizedWarning, warningText } from '../../src/client/i18n.ts'
import type { UpdateWarning } from '../../src/shared/types.ts'

const previewWarning: UpdateWarning = {
  code: 'preview-unverified',
  channel: 'alpha',
  version: '0.1.6-alpha.2',
}

describe('runtime message localization', () => {
  it('renders structured Host warnings in English', () => {
    expect(warningText(previewWarning, 'en')).toBe(
      'alpha is a preview channel; version 0.1.6-alpha.2 has not been verified as compatible with this plugin.',
    )
    expect(warningText({ code: 'registry-unavailable', detail: 'offline' }, 'en')).toBe(
      'Unable to check the npm registry: offline',
    )
  })

  it('renders the same Host warnings in Chinese', () => {
    expect(warningText(previewWarning, 'zh')).toBe(
      'alpha 是预览通道，版本 0.1.6-alpha.2 尚未验证与本插件兼容。',
    )
    expect(warningText({ code: 'registry-unavailable', detail: 'offline' }, 'zh')).toBe(
      '无法检查 npm registry：offline',
    )
  })

  it('prefers structured warnings and falls back for an older Host', () => {
    expect(localizedWarning({ warning: 'legacy fallback', warnings: [previewWarning] }, 'zh')).toContain('预览通道')
    expect(localizedWarning({ warning: 'legacy fallback' }, 'zh')).toBe('legacy fallback')
  })

  it('localizes non-command installation guidance without changing real commands', () => {
    expect(localizedUpgradeGuidance({ installKind: 'source-checkout', upgradeCommand: 'fallback' }, 'zh')).toContain('DSH 源码 checkout')
    expect(localizedUpgradeGuidance({ installKind: 'unknown', upgradeCommand: 'fallback' }, 'en')).toBe(
      'Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you.',
    )
    expect(localizedUpgradeGuidance({ installKind: 'npm-global', upgradeCommand: 'npm install -g package@alpha' }, 'zh')).toBe(
      'npm install -g package@alpha',
    )
  })
})
