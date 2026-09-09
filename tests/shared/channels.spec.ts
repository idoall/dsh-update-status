import { describe, expect, it } from 'vitest'
import { visibleChannelReleases } from '../../src/shared/channels.ts'
import type { ChannelRelease } from '../../src/shared/types.ts'

const channels: ChannelRelease[] = [
  { channel: 'latest', version: '0.1.2-rc.1', publishedAt: null, compatibility: 'verified' },
  { channel: 'next', version: '0.1.2-rc.1', publishedAt: null, compatibility: 'verified' },
  { channel: 'alpha', version: '0.1.5-alpha.2', publishedAt: null, compatibility: 'unverified' },
]

describe('visibleChannelReleases', () => {
  it('hides a redundant candidate equal to the running and stable version', () => {
    const visible = visibleChannelReleases({ currentVersion: '0.1.2-rc.1', channel: 'latest', channels })
    expect(visible.map(item => item.channel)).toEqual(['latest', 'alpha'])
  })

  it('deduplicates non-current channels that point to the same release', () => {
    const visible = visibleChannelReleases({
      currentVersion: '0.1.1',
      channel: 'latest',
      channels: [
        { ...channels[0]!, version: '0.1.2' },
        { ...channels[1]!, version: '0.1.2' },
        channels[2]!,
      ],
    })
    expect(visible.map(item => item.channel)).toEqual(['latest', 'alpha'])
  })

  it('keeps the selected preview and stable return path even when redundant', () => {
    const visible = visibleChannelReleases({ currentVersion: '0.1.2-rc.1', channel: 'next', channels })
    expect(visible.map(item => item.channel)).toEqual(['latest', 'next', 'alpha'])
  })

  it('shows a distinct candidate release when it has real upgrade value', () => {
    const visible = visibleChannelReleases({
      currentVersion: '0.1.2-rc.1',
      channel: 'latest',
      channels: [channels[0]!, { ...channels[1]!, version: '0.1.4-rc.1' }, channels[2]!],
    })
    expect(visible.map(item => item.channel)).toEqual(['latest', 'next', 'alpha'])
  })
})
