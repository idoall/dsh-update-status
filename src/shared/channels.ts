import type { ChannelRelease, UpdateStatus } from './types.ts'

const CHANNEL_ORDER = { latest: 0, next: 1, alpha: 2 } as const

/**
 * Reduce raw dist-tags to user-meaningful choices without losing Host facts.
 * The selected channel and stable return path are always present; every other
 * row must carry a version no earlier row already shows.
 *
 * A channel is deliberately NOT hidden just because it currently points at the
 * release that is running. Following a channel is a statement about future
 * releases, and `currentVersion` still rides the input for the caller's own
 * rendering, but filtering on it created a deadlock: while running the version
 * published on `alpha`, the `alpha` row disappeared, so the one channel a user
 * on that line would want to follow could never be selected — the only way to
 * see it was to already follow it.
 */
export function visibleChannelReleases(status: Pick<UpdateStatus, 'currentVersion' | 'channel' | 'channels'>): ChannelRelease[] {
  const ordered = [...status.channels].sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel])
  const mandatory = new Set(['latest', status.channel])
  const visible = ordered.filter(release => mandatory.has(release.channel))
  const seenVersions = new Set(visible.map(release => release.version).filter((version): version is string => version !== null))

  for (const release of ordered) {
    if (mandatory.has(release.channel) || release.version === null) continue
    if (seenVersions.has(release.version)) continue
    visible.push(release)
    seenVersions.add(release.version)
  }

  return visible.sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel])
}
