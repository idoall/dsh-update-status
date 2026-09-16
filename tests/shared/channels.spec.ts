import { describe, expect, it } from 'vitest'
import { visibleChannelReleases } from '../../src/shared/channels.ts'
import type { ChannelRelease } from '../../src/shared/types.ts'

const channels: ChannelRelease[] = [
  { channel: 'latest', version: '0.1.2-rc.1', publishedAt: null, compatibility: 'verified' },
  { channel: 'next', version: '0.1.2-rc.1', publishedAt: null, compatibility: 'verified' },
  { channel: 'alpha', version: '0.1.5-alpha.2', publishedAt: null, compatibility: 'unverified' },
]

describe('visibleChannelReleases', () => {
  it('hides a candidate whose version an earlier row already shows', () => {
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

  it('offers the channel that currently points at the running release', () => {
    // The real 2026-09-16 state: DSH 0.1.6-alpha.1 is running, `alpha` is that
    // release, and the operator follows `next`. Hiding the running channel made
    // `alpha` unselectable exactly when it was the line worth following.
    const visible = visibleChannelReleases({
      currentVersion: '0.1.6-alpha.1',
      channel: 'next',
      channels: [
        { channel: 'latest', version: '0.1.5-rc.1', publishedAt: null, compatibility: 'verified' },
        { channel: 'next', version: '0.1.5-rc.2', publishedAt: null, compatibility: 'unverified' },
        { channel: 'alpha', version: '0.1.6-alpha.1', publishedAt: null, compatibility: 'unverified' },
      ],
    })
    expect(visible.map(item => item.channel)).toEqual(['latest', 'next', 'alpha'])
  })

  it('still collapses channels that all point at the running release', () => {
    const visible = visibleChannelReleases({
      currentVersion: '0.1.5-rc.1',
      channel: 'latest',
      channels: [
        { channel: 'latest', version: '0.1.5-rc.1', publishedAt: null, compatibility: 'verified' },
        { channel: 'next', version: '0.1.5-rc.1', publishedAt: null, compatibility: 'verified' },
        { channel: 'alpha', version: '0.1.5-rc.1', publishedAt: null, compatibility: 'verified' },
      ],
    })
    expect(visible.map(item => item.channel)).toEqual(['latest'])
  })
})
