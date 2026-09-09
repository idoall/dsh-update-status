/** React arrives from DSH's frozen browser module table at client materialization. */
import type * as ReactNS from 'react'

// eslint/oxlint would normally discourage require; DSH's closure factory makes
// this the supported runtime import path for a third-party client bundle.
export const React: typeof ReactNS = require('react') as typeof ReactNS
export const h = React.createElement
