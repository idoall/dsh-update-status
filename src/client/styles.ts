/** Plugin-owned CSS only; no shell DOM selection or official SVG manipulation. */

export const UPDATE_STATUS_CSS = `
.dus-brand-name{align-items:center;gap:6px;height:24px;max-width:100%;min-width:0;display:inline-flex}
.dus-brand-deepseek{font-size:14px;font-weight:650;letter-spacing:-.015em;line-height:24px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The chip is a NEUTRAL SECOND-LEVEL SURFACE, never a high-contrast pill. It used
   to be label-primary + label-primary-inverted, which is a near-white box with dark
   text on the dark shell — a white frame that swallows the amber halo and fights the
   warn colour. --dsw-alias-button-floating-hover is the one palette surface that is
   grey in BOTH themes (#f1f3f5 light / #353638 dark), matching the reference: a light
   grey chip on the light shell, a dark grey chip with white text on the dark one. The
   sibling button-floating-fill is pure white in light mode and changes nothing there.
   Text stays label-primary (#0f1115 light / #f9fafb dark), so it is never low-contrast.
   Every colour here is a theme token, so the chip follows whatever appearance DSH
   resolves — light, dark, or system-follows-the-OS — with no plugin-side detection,
   no media query and no per-theme branch to keep in sync. */
.dus-badge{--dus-badge-surface:var(--dsw-alias-button-floating-hover,#f1f3f5);align-items:center;background:var(--dus-badge-surface);border:0;border-radius:4px;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;display:inline-flex;flex:none;font-family:var(--ds-font-family-code,var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace));font-size:10px;font-variant-numeric:tabular-nums;font-weight:600;gap:4px;height:16px;line-height:16px;max-width:140px;outline:none;padding:0 6px;touch-action:manipulation;user-select:none;white-space:nowrap}
.dus-badge:focus-visible,.dus-action:focus-visible,.dus-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
/* Hover has to read as "raised" in BOTH themes. brightness() only ever brightens, and on
   the light shell it turns the grey chip pure white — the chip all but disappears. Mixing
   a little of the theme's own label colour into the surface darkens it in light mode and
   lightens it in dark mode, so one declaration stays correct in both. The brightness
   filter remains the fallback: an engine without color-mix drops only the second
   declaration, never the whole hover rule. */
.dus-badge:hover{filter:brightness(1.08)}
@supports (background:color-mix(in srgb,red 50%,transparent)){.dus-badge:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--dus-badge-surface));filter:none}}
/* The failure state is the one deliberate repaint, and it follows the shell's own
   badge pattern (brokenBadge): error fill with a bg-layer-3 label, which is white
   text on the dark red of the light theme and dark text on the light red of the dark
   theme — readable in both, unlike the fixed white text it replaces. */
.dus-badge[data-error=true]{background:var(--dsw-alias-state-error-primary,#dc2626);color:var(--dsw-alias-bg-layer-3,#fff)}
.dus-badge-version{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dus-dot{background:currentColor;border-radius:50%;display:inline-block;flex:0 0 auto;height:5px;opacity:.9;width:5px}
/* An available update repaints NOTHING: the chip keeps its normal fill and only
   the amber dot breathes. The halo is animated with the dot so the glow grows
   and shrinks as one light, never as a separate ripple. The update state is
   declared AFTER the loading state, so a re-check on a known update keeps the
   amber glow instead of falling back to the neutral loading pulse.
   Each box-shadow is declared twice: a literal amber first for any engine
   without color-mix, then the halo mixed from the theme's own warn colour so the
   glow always matches the dot in both light and dark themes. */
/* The dot carries the whole status. Three states, in precedence order:
   up to date = a plain green circle (success token, never the text colour, so a
   dark theme no longer paints a black dot that reads as "off"); checking = the
   neutral grey pulse; a pending update = the amber dot below, which is the only
   state allowed to breathe or glow.
   The up-to-date rule is declared BEFORE loading and update: equal specificity, so
   the later, louder states win if two ever land on the same dot. */
.dus-dot[data-state=current]{background:var(--dsw-alias-state-success-primary,#22c55e);opacity:1}
.dus-dot[data-loading=true]{animation:dus-pulse .9s ease-in-out infinite}
.dus-dot[data-update=true]{--dus-update-color:var(--dsw-alias-state-warn-primary,#f59e0b);animation:dus-update-pulse 1.6s ease-in-out infinite;background:var(--dus-update-color);height:6px;opacity:1;width:6px}
@keyframes dus-pulse{0%,100%{opacity:.45;transform:scale(.82)}50%{opacity:1;transform:scale(1.15)}}
@keyframes dus-update-pulse{0%,100%{box-shadow:0 0 2px 0 rgba(245,158,11,.4);box-shadow:0 0 2px 0 color-mix(in srgb,var(--dus-update-color) 45%,transparent);transform:scale(.8)}50%{box-shadow:0 0 7px 2px rgba(245,158,11,.72);box-shadow:0 0 7px 2px color-mix(in srgb,var(--dus-update-color) 72%,transparent);transform:scale(1.15)}}
@media (prefers-reduced-motion:reduce){.dus-dot[data-update=true],.dus-dot[data-loading=true]{animation:none}.dus-dot[data-update=true]{box-shadow:0 0 5px 1px rgba(245,158,11,.6);box-shadow:0 0 5px 1px color-mix(in srgb,var(--dus-update-color) 62%,transparent)}}
.dus-overlay-root{background:transparent;border:0;color:inherit;height:100dvh;inset:0;margin:0;max-height:none;max-width:none;padding:0;pointer-events:none;position:fixed;width:100vw}
.dus-overlay-root::backdrop{background:transparent}
.dus-backdrop{background:transparent;inset:0;pointer-events:auto;position:absolute}
.dus-panel{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:var(--dsw-elevation-panel);box-sizing:border-box;color:var(--dsw-alias-label-primary);left:min(292px,calc(100vw - 402px));max-height:min(640px,calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)));overflow:auto;padding:14px;pointer-events:auto;position:absolute;top:12px;width:min(390px,calc(100vw - 24px));z-index:1}
.dus-panel-head{align-items:center;display:flex;gap:8px;justify-content:space-between;margin-bottom:12px}
.dus-panel-title{font-size:14px;font-weight:650}
.dus-close{align-items:center;background:transparent;border:0;border-radius:8px;color:inherit;cursor:pointer;display:inline-flex;font-size:20px;height:32px;justify-content:center;line-height:1;min-height:32px;min-width:32px;padding:0;touch-action:manipulation;width:32px}
.dus-close:hover,.dus-action:hover{background:var(--dsw-alias-button-floating-hover)}
.dus-cache-setting{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;margin:0 0 12px;padding:9px}
.dus-cache-field{align-items:center;display:flex;font-size:12px;font-weight:600;gap:10px;justify-content:space-between}
.dus-cache-input-wrap{align-items:center;display:flex;gap:6px;font-size:11px;font-weight:400}
.dus-cache-input{background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;color:inherit;font:inherit;min-height:30px;padding:0 7px;text-align:right;width:72px}
.dus-cache-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dus-cache-input:disabled{cursor:not-allowed;opacity:.55}
.dus-cache-hint{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;margin:7px 0 0}
.dus-state{border-radius:9px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45;margin:0 0 12px;padding:8px 9px}
.dus-state[data-kind=update],.dus-state[data-kind=warning]{background:var(--dsw-alias-state-warn-tertiary)}
.dus-state[data-kind=ok]{background:var(--dsw-alias-state-success-tertiary)}
.dus-state[data-kind=error]{background:var(--dsw-alias-bg-layer-3)}
.dus-metadata{display:grid;gap:9px;margin:0 0 12px}
.dus-metadata-row{align-items:baseline;display:grid;gap:8px;grid-template-columns:minmax(0,1fr) auto}
.dus-meta-label{color:var(--dsw-alias-label-secondary);font-size:12px}
.dus-meta-value{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;max-width:210px;overflow-wrap:anywhere;text-align:right}
.dus-meta-sub{color:var(--dsw-alias-label-secondary);font-size:11px;grid-column:1 / -1}
.dus-warning{border-left:2px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;margin:0 0 12px;padding-left:8px}
.dus-actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.dus-action{background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;cursor:pointer;font-size:12px;line-height:30px;min-height:32px;padding:0 10px;touch-action:manipulation}
.dus-action:disabled{cursor:wait;opacity:.65}
.dus-command-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin:0 0 6px}
.dus-command{background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:block;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:1.5;margin:0;overflow-wrap:anywhere;padding:9px;tab-size:2;user-select:text;white-space:pre-wrap}
.dus-command:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dus-note{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45;margin:8px 0 0}
.dus-copy-message{color:var(--dsw-alias-state-business-primary);font-size:11px;margin:7px 0 0}
.dus-settings{display:grid;gap:14px;max-width:640px;padding:4px 0}
.dus-settings-heading{font-size:16px;font-weight:650;margin:0}
.dus-settings-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px}
.dus-settings-toggle{align-items:flex-start;cursor:pointer;display:flex;gap:10px;font-size:13px;line-height:1.4}
.dus-settings-toggle input{accent-color:var(--dsw-alias-state-business-primary);height:18px;margin:0;min-height:18px;min-width:18px;width:18px}
.dus-settings-field{display:grid;font-size:13px;font-weight:600;gap:8px}
.dus-channel-select{background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;font:inherit;min-height:40px;padding:0 10px;width:100%}
.dus-channel-list{border-top:1px solid var(--dsw-alias-border-l2);margin:12px 0 0;padding-top:2px}
.dus-channel-row{align-items:center;display:grid;font-size:11px;gap:8px;grid-template-columns:minmax(0,1fr) auto;line-height:1.4;padding:6px 0}
.dus-channel-row[data-selected=true]{color:var(--dsw-alias-state-business-primary)}
.dus-channel-row code{font-size:11px}
.dus-channel-compat{color:var(--dsw-alias-label-secondary)}
.dus-channel-action{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;color:inherit;cursor:pointer;font-size:11px;justify-self:end;min-height:32px;padding:0 9px}
.dus-channel-action:disabled{cursor:default;opacity:.55}
.dus-channel-action:not(:disabled):hover{background:var(--dsw-alias-button-floating-hover)}
.dus-channel-compat[data-compatibility=verified]{color:var(--dsw-alias-state-success-primary)}
.dus-channel-compat[data-compatibility=incompatible]{color:var(--dsw-alias-state-error-primary)}
.dus-settings-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;margin:8px 0 0}
@media (max-width:640px),(hover:none) and (pointer:coarse){.dus-panel{border-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0;bottom:0;left:0;right:0;max-height:min(78dvh,calc(100dvh - env(safe-area-inset-top)));padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));position:fixed;top:auto;width:100vw}.dus-action{min-height:40px;line-height:38px}.dus-close{height:40px;min-height:40px;min-width:40px;width:40px}}
`
