import type { ChannelRelease, UpdateStatus } from './types.ts'

const CHANNEL_ORDER = { latest: 0, next: 1, alpha: 2 } as const

/**
 * Reduce raw dist-tags to user-meaningful choices without losing Host facts.
 * The selected channel and stable return path are mandatory; other rows must
 * represent a version that differs from both the running DSH and earlier rows.
 */
export function visibleChannelReleases(status: Pick<UpdateStatus, 'currentVersion' | 'channel' | 'channels'>): ChannelRelease[] {
  const ordered = [...status.channels].sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel])
  const mandatory = new Set(['latest', status.channel])
  const visible = ordered.filter(release => mandatory.has(release.channel))
  const seenVersions = new Set(visible.map(release => release.version).filter((version): version is string => version !== null))

  for (const release of ordered) {
    if (mandatory.has(release.channel) || release.version === null || release.version === status.currentVersion) continue
    if (seenVersions.has(release.version)) continue
    visible.push(release)
    seenVersions.add(release.version)
  }

  return visible.sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel])
}
