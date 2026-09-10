/** Plugin-owned CSS only; no shell DOM selection or official SVG manipulation. */

export const UPDATE_STATUS_CSS = `
.dus-brand-name{align-items:center;gap:8px;min-width:0;width:100%;display:flex}
.dus-brand-deepseek{color:var(--dsw-alias-text-primary,var(--dsw-alias-text-l1,#f4f4f5));flex:0 0 auto;font-size:15px;font-weight:650;letter-spacing:-.015em;white-space:nowrap}
.dus-badge{align-items:center;gap:5px;background:color-mix(in srgb,var(--dsw-alias-button-floating-fill,#222) 82%,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:999px;color:var(--dsw-alias-text-secondary,#bbb);cursor:pointer;display:inline-flex;flex:1 1 auto;font-size:11px;font-variant-numeric:tabular-nums;line-height:20px;max-width:132px;min-width:0;outline:none;padding:0 8px;touch-action:manipulation;user-select:none}
.dus-badge:focus-visible,.dus-footer-button:focus-visible,.dus-action:focus-visible,.dus-close:focus-visible{outline:2px solid var(--dsw-alias-accent,#4d8cff);outline-offset:2px}
.dus-badge:hover{background:var(--dsw-alias-button-floating-hover,rgba(255,255,255,.12))}
.dus-badge[data-update=true]{border-color:color-mix(in srgb,var(--dsw-alias-accent,#4d8cff) 72%,transparent);color:var(--dsw-alias-accent,#78a7ff)}
.dus-badge[data-error=true]{border-color:color-mix(in srgb,#e6a23c 70%,transparent);color:#e6a23c}
.dus-badge-version{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dus-dot{background:currentColor;border-radius:50%;display:inline-block;flex:0 0 auto;height:6px;width:6px}
.dus-dot[data-update=true]{animation:dus-pulse 1.5s ease-in-out infinite;background:#f0aa3c}
.dus-dot[data-loading=true]{animation:dus-pulse .9s ease-in-out infinite}
@keyframes dus-pulse{0%,100%{opacity:.45;transform:scale(.82)}50%{opacity:1;transform:scale(1.15)}}
@media (prefers-reduced-motion:reduce){.dus-dot[data-update=true],.dus-dot[data-loading=true]{animation:none}}
.dus-footer-button{align-items:center;background:transparent;border:0;border-radius:10px;color:var(--dsw-alias-text-secondary,#b5b5bc);cursor:pointer;display:flex;height:44px;justify-content:center;min-height:44px;min-width:44px;padding:0;position:relative;touch-action:manipulation;width:44px}
.dus-footer-button:hover{background:var(--dsw-alias-button-floating-hover,rgba(255,255,255,.1));color:var(--dsw-alias-text-primary,#fff)}
.dus-footer-icon{font-size:18px;line-height:1}
.dus-footer-dot{border:1.5px solid var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,#171719));position:absolute;right:9px;top:9px}
.dus-overlay-root{background:transparent;border:0;color:inherit;height:100dvh;inset:0;margin:0;max-height:none;max-width:none;padding:0;pointer-events:none;position:fixed;width:100vw}
.dus-overlay-root::backdrop{background:transparent}
.dus-backdrop{background:transparent;inset:0;pointer-events:auto;position:absolute}
.dus-panel{background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#202024));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.32);box-sizing:border-box;color:var(--dsw-alias-text-primary,#f4f4f5);max-height:min(640px,calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)));overflow:auto;padding:14px;pointer-events:auto;position:absolute;top:12px;width:min(390px,calc(100vw - 24px));z-index:1}
.dus-panel[data-origin=brand]{left:min(292px,calc(100vw - 402px))}
.dus-panel[data-origin=rail]{left:min(68px,calc(100vw - 402px))}
.dus-panel-head{align-items:center;display:flex;gap:8px;justify-content:space-between;margin-bottom:12px}
.dus-panel-title{font-size:14px;font-weight:650}
.dus-close{align-items:center;background:transparent;border:0;border-radius:8px;color:inherit;cursor:pointer;display:inline-flex;font-size:20px;height:32px;justify-content:center;line-height:1;min-height:32px;min-width:32px;padding:0;touch-action:manipulation;width:32px}
.dus-close:hover,.dus-action:hover{background:var(--dsw-alias-button-floating-hover,rgba(255,255,255,.1))}
.dus-state{border-radius:9px;font-size:12px;line-height:1.45;margin:0 0 12px;padding:8px 9px}
.dus-state[data-kind=update]{background:color-mix(in srgb,#d9911e 16%,transparent);color:#f5c56f}
.dus-state[data-kind=ok]{background:color-mix(in srgb,#47a879 14%,transparent);color:#9ed6b7}
.dus-state[data-kind=warning]{background:color-mix(in srgb,#d9911e 14%,transparent);color:#f1c66f}
.dus-state[data-kind=error]{background:color-mix(in srgb,#d96363 15%,transparent);color:#f4a1a1}
.dus-metadata{display:grid;gap:9px;margin:0 0 12px}
.dus-metadata-row{align-items:baseline;display:grid;gap:8px;grid-template-columns:minmax(0,1fr) auto}
.dus-meta-label{color:var(--dsw-alias-text-secondary,#aaa);font-size:12px}
.dus-meta-value{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;max-width:210px;overflow-wrap:anywhere;text-align:right}
.dus-meta-sub{color:var(--dsw-alias-text-secondary,#aaa);font-size:11px;grid-column:1 / -1}
.dus-warning{border-left:2px solid #d9911e;color:var(--dsw-alias-text-secondary,#c7c7cc);font-size:12px;line-height:1.45;margin:0 0 12px;padding-left:8px}
.dus-actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.dus-action{background:var(--dsw-alias-button-floating-fill,rgba(255,255,255,.08));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:8px;color:inherit;cursor:pointer;font-size:12px;line-height:30px;min-height:32px;padding:0 10px;touch-action:manipulation}
.dus-action:disabled{cursor:wait;opacity:.65}
.dus-command-label{color:var(--dsw-alias-text-secondary,#aaa);font-size:12px;font-weight:600;margin:0 0 6px}
.dus-command{background:color-mix(in srgb,var(--dsw-alias-bg-base,#151518) 76%,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.13));border-radius:8px;display:block;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:1.5;margin:0;overflow-wrap:anywhere;padding:9px;tab-size:2;user-select:text;white-space:pre-wrap}
.dus-command:focus{outline:2px solid var(--dsw-alias-accent,#4d8cff);outline-offset:2px}
.dus-note{color:var(--dsw-alias-text-secondary,#aaa);font-size:11px;line-height:1.45;margin:8px 0 0}
.dus-copy-message{color:var(--dsw-alias-accent,#78a7ff);font-size:11px;margin:7px 0 0}
.dus-settings{display:grid;gap:14px;max-width:640px;padding:4px 0}
.dus-settings-heading{font-size:16px;font-weight:650;margin:0}
.dus-settings-card{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;padding:12px}
.dus-settings-toggle{align-items:flex-start;cursor:pointer;display:flex;gap:10px;font-size:13px;line-height:1.4}
.dus-settings-toggle input{accent-color:var(--dsw-alias-accent,#4d8cff);height:18px;margin:0;min-height:18px;min-width:18px;width:18px}
.dus-settings-field{display:grid;font-size:13px;font-weight:600;gap:8px}
.dus-channel-select{background:var(--dsw-alias-bg-base,#18181b);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:8px;color:inherit;font:inherit;min-height:40px;padding:0 10px;width:100%}
.dus-channel-list{border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.13));margin:12px 0 0;padding-top:2px}
.dus-channel-row{align-items:center;display:grid;font-size:11px;gap:8px;grid-template-columns:minmax(0,1fr) auto;line-height:1.4;padding:6px 0}
.dus-channel-row[data-selected=true]{color:var(--dsw-alias-accent,#78a7ff)}
.dus-channel-row code{font-size:11px}
.dus-channel-compat{color:var(--dsw-alias-text-secondary,#aaa)}
.dus-channel-action{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:7px;color:inherit;cursor:pointer;font-size:11px;justify-self:end;min-height:32px;padding:0 9px}
.dus-channel-action:disabled{cursor:default;opacity:.55}
.dus-channel-action:not(:disabled):hover{background:var(--dsw-alias-button-floating-hover,rgba(255,255,255,.1))}
.dus-channel-compat[data-compatibility=verified]{color:#64b58b}
.dus-channel-compat[data-compatibility=incompatible]{color:#e06c75}
.dus-settings-hint{color:var(--dsw-alias-text-secondary,#aaa);font-size:12px;line-height:1.45;margin:8px 0 0}
@media (max-width:640px),(hover:none) and (pointer:coarse){.dus-panel[data-origin]{border-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0;bottom:0;left:0;right:0;max-height:min(78dvh,calc(100dvh - env(safe-area-inset-top)));padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));position:fixed;top:auto;width:100vw}.dus-footer-button{height:48px;min-height:48px;min-width:48px;width:48px}.dus-badge{line-height:24px;min-height:28px}.dus-action{min-height:40px;line-height:38px}.dus-close{height:40px;min-height:40px;min-width:40px;width:40px}}
`
