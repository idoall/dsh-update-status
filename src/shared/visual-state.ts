/**
 * The single place that decides which visual state the sidebar chip is in.
 *
 * It lives in `shared` rather than inside the component so the decision is a pure
 * function that a test can drive directly: the regression this guards against is
 * exactly a state-classification mistake, and it was invisible to every test while
 * it sat inside TSX.
 */
import type { UpdateStatus } from './types.ts'

export type VisualState = 'loading' | 'update' | 'current' | 'problem'

/**
 * Only a read the plugin could not complete is a chip-level problem.
 *
 * An advisory notice — a preview channel this bundle has not been verified against,
 * say — leaves the chip surface alone and belongs in the panel. Repainting the brand
 * row for a plugin-side bookkeeping fact is the surprise the breathing dot replaced:
 * an operator who upgrades DSH ahead of this bundle must not watch the chip turn red.
 *
 * A Host older than `warningKind` sends no field at all; `undefined` then keeps the
 * previous behaviour (any warning is a problem) rather than silently dropping a real
 * failure on the floor.
 */
export function isChipProblem(status: UpdateStatus | null): boolean {
  if (status === null) return false
  if (status.warningKind === undefined) return status.warning !== null
  return status.warningKind === 'failure'
}

export function visualState(status: UpdateStatus | null, loading: boolean, error: string | null): VisualState {
  if (loading) return 'loading'
  if (error !== null || isChipProblem(status)) return status?.hasUpdate === true ? 'update' : 'problem'
  return status?.hasUpdate === true ? 'update' : 'current'
}
