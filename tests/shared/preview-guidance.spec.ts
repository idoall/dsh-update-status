import { describe, it, expect } from 'vitest'
import { previewCommand } from '../../src/shared/preview-guidance.ts'
import type { UpdateStatus } from '../../src/shared/types.ts'

describe('read-only pinned preview guidance', () => {
  const status = { installKind: 'npm-global', channel: 'latest' } as UpdateStatus
  it('pins displayed target without changing followed channel', () => {
    expect(previewCommand(status, '0.2.0-alpha.2')).toBe('npm install -g @deepseek-ai/dsh@0.2.0-alpha.2')
    expect(status.channel).toBe('latest')
    expect(previewCommand({ ...status, installKind: 'pnpm-global' }, '0.2.0-rc.1')).toBe('pnpm add -g @deepseek-ai/dsh@0.2.0-rc.1')
  })
  it('withholds commands for unknown installation or unsafe/missing targets', () => {
    for (const version of [null, 'next', '0.2.0; echo unsafe', ' 0.2.0']) expect(previewCommand(status, version)).toBeNull()
    expect(previewCommand({ ...status, installKind: 'unknown' }, '0.2.0')).toBeNull()
    expect(previewCommand({ ...status, installKind: 'source-checkout' }, '0.2.0')).toBeNull()
  })
})
