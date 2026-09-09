/**
 * Small, dependency-free SemVer 2.0 comparator for the host check path.
 * It intentionally accepts the common leading `v` used by release tags while
 * preserving prerelease precedence (`0.1.2-rc.1 < 0.1.2`).
 */

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: readonly string[]
}

const SEMVER = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const NUMERIC_IDENTIFIER = /^(0|[1-9]\d*)$/

export function parseSemver(value: string): ParsedSemver | undefined {
  const match = SEMVER.exec(value.trim())
  if (match === null) return undefined
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return undefined
  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  return { major, minor, patch, prerelease }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left)
  const rightNumeric = NUMERIC_IDENTIFIER.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Returns a negative number when left is older; undefined means unparsable. */
export function compareSemver(leftValue: string, rightValue: string): number | undefined {
  const left = parseSemver(leftValue)
  const right = parseSemver(rightValue)
  if (left === undefined || right === undefined) return undefined

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }

  const leftStable = left.prerelease.length === 0
  const rightStable = right.prerelease.length === 0
  if (leftStable && rightStable) return 0
  if (leftStable) return 1
  if (rightStable) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const comparison = compareIdentifier(leftPart, rightPart)
    if (comparison !== 0) return comparison
  }
  return 0
}

/** False rather than a guess when either version is not valid SemVer. */
export function hasSemverUpdate(currentVersion: string, latestVersion: string): boolean {
  const comparison = compareSemver(currentVersion, latestVersion)
  return comparison !== undefined && comparison < 0
}
