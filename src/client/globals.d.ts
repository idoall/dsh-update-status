/** DSH client bundles execute in a CJS factory supplied by the web module loader. */
declare function require(id: string): unknown
declare let module: { exports: Record<string, unknown> }
declare let exports: Record<string, unknown>
