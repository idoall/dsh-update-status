import type { UpdateStatus } from './types.ts'
import { PACKAGE_NAME } from './types.ts'
import { parseSemver } from './semver.ts'

/** Pinned guidance only: never execute a command or mutate the followed channel. */
export function previewCommand(status: UpdateStatus, version: string | null): string | null {
  if (version === null || version.trim() !== version || parseSemver(version) === undefined) return null
  if (status.installKind === 'npm-global') return `npm install -g ${PACKAGE_NAME}@${version}`
  if (status.installKind === 'pnpm-global') return `pnpm add -g ${PACKAGE_NAME}@${version}`
  return null
}
