window.__ModuleLoader__.load({
	id: "dsh-update-status",
	factory: (require) => {
		var module = { exports: {} };
		module.exports;
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared/channels.ts
		const CHANNEL_ORDER = {
			latest: 0,
			next: 1,
			alpha: 2
		};
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
		function visibleChannelReleases(status) {
			const ordered = [...status.channels].sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel]);
			const mandatory = /* @__PURE__ */ new Set(["latest", status.channel]);
			const visible = ordered.filter((release) => mandatory.has(release.channel));
			const seenVersions = new Set(visible.map((release) => release.version).filter((version) => version !== null));
			for (const release of ordered) {
				if (mandatory.has(release.channel) || release.version === null) continue;
				if (seenVersions.has(release.version)) continue;
				visible.push(release);
				seenVersions.add(release.version);
			}
			return visible.sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel]);
		}
		//#endregion
		//#region src/shared/types.ts
		/**
		* JSON-only contract shared by the Host and Web halves.
		*
		* The static package uses the authenticated Connection RPC channel because
		* `harness.handle` / `host.call` are dynamic-Cordis-only closure APIs. The
		* endpoint vocabulary remains deliberately small and private to this plugin
		* channel.
		*/
		const PLUGIN_ID$1 = "dsh-update-status";
		const PACKAGE_NAME = "@deepseek-ai/dsh";
		/** Shared Connection RPC channel. Custom prefixes 405 on the SPA fallback. */
		const UPDATE_STATUS_CHANNEL = "/api";
		const MAX_CACHE_TTL_MINUTES = 1440;
		function isCacheTtlMinutes(value) {
			return typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 1440;
		}
		const UPDATE_ENDPOINTS = {
			getStatus: "dsh-update-status.get-status",
			checkUpdate: "dsh-update-status.check-update"
		};
		function isReleaseChannel(value) {
			return value === "latest" || value === "next" || value === "alpha";
		}
		//#endregion
		//#region src/shared/semver.ts
		const SEMVER = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
		function parseSemver(value) {
			const match = SEMVER.exec(value.trim());
			if (match === null) return void 0;
			const major = Number(match[1]);
			const minor = Number(match[2]);
			const patch = Number(match[3]);
			if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return void 0;
			return {
				major,
				minor,
				patch,
				prerelease: match[4] === void 0 ? [] : match[4].split(".")
			};
		}
		//#endregion
		//#region src/shared/preview-guidance.ts
		/** Pinned guidance only: never execute a command or mutate the followed channel. */
		function previewCommand(status, version) {
			if (version === null || version.trim() !== version || parseSemver(version) === void 0) return null;
			if (status.installKind === "npm-global") return `npm install -g ${PACKAGE_NAME}@${version}`;
			if (status.installKind === "pnpm-global") return `pnpm add -g ${PACKAGE_NAME}@${version}`;
			return null;
		}
		//#endregion
		//#region src/shared/visual-state.ts
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
		function isChipProblem(status) {
			if (status === null) return false;
			if (status.warningKind === void 0) return status.warning !== null;
			return status.warningKind === "failure";
		}
		//#endregion
		//#region src/client/i18n.ts
		const DICTIONARY = {
			"brand.status": {
				zh: "DSH 版本状态",
				en: "DSH version status"
			},
			"brand.checking": {
				zh: "正在检查版本",
				en: "Checking version"
			},
			"brand.update": {
				zh: "有可用更新",
				en: "Update available"
			},
			"brand.current": {
				zh: "已是最新或尚未发现更新",
				en: "Up to date or no update found"
			},
			"brand.problem": {
				zh: "检查遇到问题",
				en: "Check encountered a problem"
			},
			"footer.status": {
				zh: "打开 DSH 版本状态",
				en: "Open DSH version status"
			},
			"panel.title": {
				zh: "DSH 更新状态",
				en: "DSH update status"
			},
			"panel.close": {
				zh: "关闭",
				en: "Close"
			},
			"panel.cacheDuration": {
				zh: "缓存时长",
				en: "Cache duration"
			},
			"panel.minutes": {
				zh: "分钟",
				en: "minutes"
			},
			"panel.cacheHint": {
				zh: "到期后在下次打开或读取状态时检查；不会后台轮询。点击“检查更新”会立即检查。",
				en: "After expiry, DSH checks only on the next status read; there is no background polling. “Check for updates” checks immediately."
			},
			"panel.cacheReadonly": {
				zh: "此连接的缓存设置为只读。",
				en: "This connection’s cache setting is read-only."
			},
			"panel.current": {
				zh: "当前运行版本",
				en: "Current running version"
			},
			"panel.latest": {
				zh: "所选通道版本",
				en: "Selected channel version"
			},
			"panel.channels": {
				zh: "可用发布通道",
				en: "Available release channels"
			},
			"panel.compatVerified": {
				zh: "已验证兼容",
				en: "Verified compatible"
			},
			"panel.compatUnverified": {
				zh: "尚未验证兼容",
				en: "Compatibility unverified"
			},
			"panel.compatIncompatible": {
				zh: "已知不兼容",
				en: "Known incompatible"
			},
			"panel.selectChannel": {
				zh: "选择此通道",
				en: "Select channel"
			},
			"panel.selectedChannel": {
				zh: "已选择",
				en: "Selected"
			},
			"panel.notChecked": {
				zh: "尚未取得",
				en: "Not available yet"
			},
			"panel.available": {
				zh: "发现新版本",
				en: "Update available"
			},
			"panel.currentState": {
				zh: "未发现可用更新",
				en: "No update found"
			},
			"panel.cached": {
				zh: "来自 Host 缓存",
				en: "From Host cache"
			},
			"panel.live": {
				zh: "刚从 npm registry 检查",
				en: "Checked npm registry now"
			},
			"panel.checkedAt": {
				zh: "上次检查",
				en: "Last checked"
			},
			"panel.publishedAt": {
				zh: "发布时间",
				en: "Published"
			},
			"panel.check": {
				zh: "检查更新",
				en: "Check for updates"
			},
			"panel.checking": {
				zh: "检查中…",
				en: "Checking…"
			},
			"panel.switchingChannel": {
				zh: "正在切换通道…",
				en: "Switching channel…"
			},
			"panel.releaseNotes": {
				zh: "发布说明",
				en: "Release notes"
			},
			"panel.command": {
				zh: "升级命令",
				en: "Upgrade command"
			},
			"panel.copy": {
				zh: "复制命令",
				en: "Copy command"
			},
			"panel.copied": {
				zh: "已复制",
				en: "Copied"
			},
			"panel.copyFallback": {
				zh: "浏览器未允许复制；已选中文本，请长按或复制。",
				en: "Clipboard unavailable; the command is selected for long-press or copy."
			},
			"panel.commandNote": {
				zh: "仅复制，不会执行。请在运行 DSH 的那台电脑的终端执行；完成后由你自行重启 DSH。",
				en: "Copy only — nothing runs here. Execute it in a terminal on the computer running DSH, then restart DSH yourself."
			},
			"panel.readOnly": {
				zh: "阶段 1 仅提示：本插件不会安装、重启、回滚或替换任何文件。",
				en: "Phase 1 is advisory only: this plugin never installs, restarts, rolls back, or replaces files."
			},
			"panel.error": {
				zh: "检查提示",
				en: "Check notice"
			},
			"warning.registryUnavailable": {
				zh: "无法检查 npm registry：{detail}",
				en: "Unable to check the npm registry: {detail}"
			},
			"warning.channelUnavailable": {
				zh: "npm registry 未发布 {channel} 通道。",
				en: "The npm registry does not publish a {channel} channel."
			},
			"warning.versionIncomparable": {
				zh: "无法按 SemVer 比较当前版本 {currentVersion} 与 {channel} 通道版本 {selectedVersion}。",
				en: "Unable to compare the current version {currentVersion} with {channel} channel version {selectedVersion} using SemVer."
			},
			"warning.previewUnverified": {
				zh: "{channel} 是预览通道，版本 {version} 尚未验证与本插件兼容。",
				en: "{channel} is a preview channel; version {version} has not been verified as compatible with this plugin."
			},
			"warning.staleSchemastery": {
				zh: "本插件解析到的 @deepseek-ai/schemastery（版本 {version}）来自 {path}，不是 DSH 自带的那份，偏好字段无法标记为 volatile。请删除该残留目录并重启 DSH：rm -rf {nodeModulesDir}",
				en: "This plugin resolved @deepseek-ai/schemastery {version} from {path} instead of the copy DSH provides, so preference fields cannot be marked volatile. Remove the stale directory and restart DSH: rm -rf {nodeModulesDir}"
			},
			"warning.staleSchemasteryNoPath": {
				zh: "本插件解析到的 @deepseek-ai/schemastery（版本 {version}）来自 {path}，不是 DSH 自带的那份，偏好字段无法标记为 volatile。请删除该处残留的 @deepseek-ai/schemastery 目录并重启 DSH。",
				en: "This plugin resolved @deepseek-ai/schemastery {version} from {path} instead of the copy DSH provides, so preference fields cannot be marked volatile. Remove the stale @deepseek-ai/schemastery directory there and restart DSH."
			},
			"guidance.sourceCheckout": {
				zh: "请更新 DSH 源码 checkout、安装依赖并重新构建；本插件无法从 GUI 原地替换。",
				en: "Update the DSH source checkout, install its dependencies, and rebuild it; this plugin cannot replace it in place from the GUI."
			},
			"guidance.unknownInstall": {
				zh: "升级前请先确认 DSH 的安装方式；本插件无法代为执行升级。",
				en: "Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you."
			},
			"panel.static": {
				zh: "此连接只显示静态版本；请在运行 DSH 的本机打开侧栏查看完整更新信息。",
				en: "This connection shows only the static version. Open the sidebar on the computer running DSH for full update details."
			},
			"preview.open": {
				zh: "查看预览版升级方式",
				en: "View preview upgrade instructions"
			},
			"preview.close": {
				zh: "收起升级说明",
				en: "Hide upgrade instructions"
			},
			"preview.follow": {
				zh: "关注通道只影响检查结果，不代表已安装或已切换版本。",
				en: "Following a channel only changes update checks, not the installed version."
			},
			"preview.target": {
				zh: "目标版本",
				en: "Target version"
			},
			"preview.risk": {
				zh: "预览版本可能不稳定，插件兼容性尚需确认。执行前请保存工作、备份配置并结束运行中的任务；安装后需手动重启 DSH。此页面不会安装或重启。",
				en: "Preview builds may be unstable and plugin compatibility needs checking. Save work, back up configuration and finish active tasks before executing. Restart DSH manually afterwards. This page never installs or restarts."
			},
			"preview.unavailable": {
				zh: "暂无可确认的预览目标，请先检查更新。",
				en: "No confirmed preview target. Check for updates first."
			},
			"preview.manual": {
				zh: "当前安装方式无法安全生成命令，请先确认安装来源；源码安装需按其构建说明操作。",
				en: "Cannot safely generate a command for this installation. Confirm its source; source checkouts require their build instructions."
			},
			"preview.same": {
				zh: "此目标与当前运行版本相同，无需重复安装。",
				en: "This target is already running; no reinstall is needed."
			},
			"settings.title": {
				zh: "版本与更新",
				en: "Version & updates"
			},
			"settings.sidebar": {
				zh: "在侧栏显示版本状态入口",
				en: "Show the version-status entry in the sidebar"
			},
			"settings.sidebarHint": {
				zh: "关闭后不再渲染品牌 Badge 和收起轨道兜底入口。不会执行或安排升级。",
				en: "When off, the brand badge and collapsed-rail fallback are not rendered. No update is run or scheduled."
			},
			"settings.channel": {
				zh: "关注发布通道",
				en: "Release channel to follow"
			},
			"settings.channelLatest": {
				zh: "稳定版（latest，推荐）",
				en: "Stable (latest, recommended)"
			},
			"settings.channelNext": {
				zh: "候选版（next）",
				en: "Release candidate (next)"
			},
			"settings.channelAlpha": {
				zh: "预览版（alpha）",
				en: "Preview (alpha)"
			},
			"settings.channelHint": {
				zh: "预览通道可能包含未稳定接口或插件兼容性变化。这里只检查并生成命令，不会安装。",
				en: "Preview channels may contain unstable APIs or plugin compatibility changes. This only checks and generates a command; it never installs."
			},
			"settings.readonly": {
				zh: "此连接的设置为只读；显示状态不受影响。",
				en: "Settings are read-only on this connection; status display is unchanged."
			}
		};
		function languageOf() {
			try {
				return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
			} catch {
				return "en";
			}
		}
		function t(key, params = {}, language = languageOf()) {
			const entry = DICTIONARY[key];
			if (entry === void 0) return key;
			return (entry[language] ?? entry.en).replace(/\{([A-Za-z]+)\}/g, (match, name) => params[name] ?? match);
		}
		function warningText(warning, language = languageOf()) {
			switch (warning.code) {
				case "registry-unavailable": return t("warning.registryUnavailable", { detail: warning.detail }, language);
				case "channel-unavailable": return t("warning.channelUnavailable", { channel: warning.channel }, language);
				case "version-incomparable": return t("warning.versionIncomparable", {
					currentVersion: warning.currentVersion,
					channel: warning.channel,
					selectedVersion: warning.selectedVersion
				}, language);
				case "preview-unverified": return t("warning.previewUnverified", {
					channel: warning.channel,
					version: warning.version
				}, language);
				case "stale-schemastery": {
					const params = {
						version: warning.version ?? "—",
						path: warning.path
					};
					return warning.nodeModulesDir === null ? t("warning.staleSchemasteryNoPath", params, language) : t("warning.staleSchemastery", {
						...params,
						nodeModulesDir: warning.nodeModulesDir
					}, language);
				}
			}
		}
		/** Prefer structured warnings, but keep the Host string for mixed-version clients. */
		function localizedWarning(status, language = languageOf()) {
			const warnings = status.warnings ?? [];
			return warnings.length === 0 ? status.warning : warnings.map((item) => warningText(item, language)).join(" ");
		}
		function localizedUpgradeGuidance(status, language = languageOf()) {
			if (status.installKind === "source-checkout") return t("guidance.sourceCheckout", {}, language);
			if (status.installKind === "unknown") return t("guidance.unknownInstall", {}, language);
			return status.upgradeCommand;
		}
		//#endregion
		//#region src/client/react.ts
		const React = require("react");
		React.createElement;
		//#endregion
		//#region src/client/components.tsx
		function useObservable(store) {
			return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
		}
		function timeText(value) {
			if (value === null) return null;
			try {
				return new Intl.DateTimeFormat(void 0, {
					dateStyle: "medium",
					timeStyle: "short"
				}).format(new Date(value));
			} catch {
				return value;
			}
		}
		function shortVersion(value) {
			if (value.length <= 16) return value;
			return value.slice(0, 15) + "…";
		}
		function channelLabel(channel) {
			if (channel === "latest") return t("settings.channelLatest");
			if (channel === "next") return t("settings.channelNext");
			return t("settings.channelAlpha");
		}
		function compatibilityLabel(value) {
			if (value === "verified") return t("panel.compatVerified");
			if (value === "incompatible") return t("panel.compatIncompatible");
			return t("panel.compatUnverified");
		}
		/** Persists a cache policy only; it never schedules a browser or Host timer. */
		function CacheTtlControl({ preferences }) {
			const snapshot = useObservable(preferences);
			const [draft, setDraft] = React.useState(String(snapshot.cacheTtlMinutes));
			React.useEffect(() => {
				setDraft(String(snapshot.cacheTtlMinutes));
			}, [snapshot.cacheTtlMinutes]);
			const save = () => {
				const value = Number(draft);
				if (isCacheTtlMinutes(value)) preferences.setCacheTtlMinutes(value);
				else setDraft(String(snapshot.cacheTtlMinutes));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dus-cache-setting",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dus-cache-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.cacheDuration") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dus-cache-input-wrap",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dus-cache-input",
								type: "number",
								inputMode: "numeric",
								min: 30,
								max: MAX_CACHE_TTL_MINUTES,
								step: 1,
								value: draft,
								disabled: !snapshot.writable,
								"aria-describedby": "dus-cache-hint",
								onChange: (event) => {
									setDraft(event.currentTarget.value);
								},
								onBlur: save,
								onKeyDown: (event) => {
									if (event.key === "Enter") event.currentTarget.blur();
									if (event.key === "Escape") {
										setDraft(String(snapshot.cacheTtlMinutes));
										event.currentTarget.blur();
									}
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.minutes") })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dus-cache-hint",
						id: "dus-cache-hint",
						children: t("panel.cacheHint")
					}),
					!snapshot.writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dus-cache-hint",
						children: t("panel.cacheReadonly")
					})
				]
			});
		}
		function visualState(status, loading, error) {
			if (loading) return "loading";
			if (error !== null || isChipProblem(status)) return status?.hasUpdate === true ? "update" : "problem";
			return status?.hasUpdate === true ? "update" : "current";
		}
		function badgeLabel(status, loading, error) {
			const state = visualState(status, loading, error);
			if (state === "loading") return t("brand.checking");
			if (state === "update") return t("brand.update");
			if (state === "problem") return t("brand.problem");
			return t("brand.current");
		}
		/** Occupies ONLY sidebar.brand.name; the official fish mark stays untouched. */
		function BrandName({ ui }) {
			const preferences = useObservable(ui.preferences);
			const snapshot = useObservable(ui.status);
			if (!preferences.sidebarEnabled) return null;
			const state = visualState(snapshot.status, snapshot.loading, snapshot.error);
			const version = snapshot.status?.currentVersion ?? "—";
			const activate = (event) => {
				event.preventDefault();
				event.stopPropagation();
				const target = event.currentTarget;
				if (target instanceof HTMLElement) target.blur();
				ui.panel.toggle("brand");
			};
			const onKeyDown = (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				activate(event);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dus-brand-name",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dus-brand-deepseek",
					children: "DeepSeek"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dus-badge",
					"data-update": snapshot.status?.hasUpdate === true || void 0,
					"data-error": state === "problem" || void 0,
					role: "button",
					tabIndex: 0,
					"aria-label": badgeLabel(snapshot.status, snapshot.loading, snapshot.error),
					title: badgeLabel(snapshot.status, snapshot.loading, snapshot.error),
					onClick: activate,
					onKeyDown,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dus-badge-version",
						children: shortVersion(version)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dus-dot",
						"data-state": state,
						"data-update": snapshot.status?.hasUpdate === true || void 0,
						"data-loading": snapshot.loading || void 0,
						"aria-hidden": "true"
					})]
				})]
			});
		}
		/** List-slot fallback: it deliberately disappears while the name badge is wide. */
		function FooterAction({ wide, ui }) {
			const preferences = useObservable(ui.preferences);
			const snapshot = useObservable(ui.status);
			if (wide === true || !preferences.sidebarEnabled) return null;
			const state = visualState(snapshot.status, snapshot.loading, snapshot.error);
			const label = badgeLabel(snapshot.status, snapshot.loading, snapshot.error);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				className: "dus-footer-button",
				type: "button",
				"aria-label": t("footer.status"),
				title: label,
				onClick: () => {
					ui.panel.toggle("rail");
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dus-footer-icon",
					"aria-hidden": "true",
					children: "↟"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dus-dot dus-footer-dot",
					"data-state": state,
					"data-update": snapshot.status?.hasUpdate === true || void 0,
					"data-loading": state === "loading" || void 0
				})]
			});
		}
		function statusSummary(status, loading, error) {
			if (loading && status === null) return {
				kind: "warning",
				text: t("brand.checking")
			};
			if (error !== null) return {
				kind: "error",
				text: error
			};
			if (status?.hasUpdate === true) return {
				kind: "update",
				text: t("panel.available")
			};
			if (status !== null) {
				const warning = localizedWarning(status);
				if (warning !== null) return {
					kind: "warning",
					text: warning
				};
			}
			return {
				kind: "ok",
				text: t("panel.currentState")
			};
		}
		function selectCommand(element) {
			if (element === null) return;
			try {
				const selection = window.getSelection();
				if (selection === null) return;
				const range = document.createRange();
				range.selectNodeContents(element);
				selection.removeAllRanges();
				selection.addRange(range);
				element.focus();
			} catch {}
		}
		/** Full detail from whichever page the operator is on (the transport is authenticated). */
		function UpdatePanel({ ui }) {
			const panel = useObservable(ui.panel);
			const preferences = useObservable(ui.preferences);
			const snapshot = useObservable(ui.status);
			const commandRef = React.useRef(null);
			const dialogRef = React.useRef(null);
			const [copyMessage, setCopyMessage] = React.useState(null);
			const visible = panel.open && preferences.sidebarEnabled;
			React.useLayoutEffect(() => {
				if (!visible) return void 0;
				const dialog = dialogRef.current;
				if (dialog === null) return void 0;
				try {
					if (!dialog.open) dialog.showModal();
				} catch {
					dialog.setAttribute("open", "");
				}
				return () => {
					if (dialog.open) dialog.close();
				};
			}, [visible]);
			React.useEffect(() => {
				if (!panel.open) return void 0;
				const onKeyDown = (event) => {
					if (event.key === "Escape") ui.panel.close();
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [panel.open, ui.panel]);
			if (!visible) return null;
			const status = snapshot.status;
			const warning = status === null ? null : localizedWarning(status);
			const summary = statusSummary(status, snapshot.loading, snapshot.error);
			const switchingChannel = status !== null && status.channel !== preferences.channel;
			const command = switchingChannel ? t("panel.switchingChannel") : status === null ? "—" : localizedUpgradeGuidance(status);
			const copy = async () => {
				setCopyMessage(null);
				try {
					if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
					await navigator.clipboard.writeText(command);
					setCopyMessage(t("panel.copied"));
				} catch {
					selectCommand(commandRef.current);
					setCopyMessage(t("panel.copyFallback"));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dialog", {
				ref: dialogRef,
				className: "dus-overlay-root",
				"aria-label": t("panel.title"),
				onCancel: (event) => {
					event.preventDefault();
					ui.panel.close();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dus-backdrop",
					onClick: () => {
						ui.panel.close();
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dus-panel",
					"data-origin": panel.origin,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("panel.title"),
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dus-panel-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dus-panel-title",
								children: t("panel.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dus-close",
								type: "button",
								"aria-label": t("panel.close"),
								onClick: () => {
									ui.panel.close();
								},
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CacheTtlControl, { preferences: ui.preferences }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dus-state",
							"data-kind": summary.kind,
							children: summary.text
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dus-metadata",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dus-metadata-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dus-meta-label",
										children: t("panel.current")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: "dus-meta-value",
										children: status?.currentVersion ?? "…"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dus-metadata-row",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dus-meta-label",
											children: [
												t("panel.latest"),
												" · ",
												status === null ? "latest" : channelLabel(status.channel)
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: "dus-meta-value",
											children: status?.latestVersion ?? t("panel.notChecked")
										}),
										status?.publishedAt !== null && status?.publishedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dus-meta-sub",
											children: [
												t("panel.publishedAt"),
												": ",
												timeText(status.publishedAt)
											]
										})
									]
								}),
								status?.checkedAt !== null && status?.checkedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dus-metadata-row",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dus-meta-label",
											children: t("panel.checkedAt")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dus-meta-value",
											children: timeText(status.checkedAt)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dus-meta-sub",
											children: status.cached ? t("panel.cached") : t("panel.live")
										})
									]
								})
							]
						}),
						status !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dus-channel-list",
							"aria-label": t("panel.channels"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dus-command-label",
								children: t("panel.channels")
							}), visibleChannelReleases(status).map((release) => {
								const selected = release.channel === preferences.channel;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dus-channel-row",
									"data-selected": selected || void 0,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: channelLabel(release.channel) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: release.version ?? "—" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dus-channel-compat",
											"data-compatibility": release.compatibility,
											children: compatibilityLabel(release.compatibility)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: "dus-channel-action",
											type: "button",
											disabled: selected || !preferences.writable || release.version === null,
											"aria-label": `${selected ? t("panel.selectedChannel") : t("panel.selectChannel")}: ${channelLabel(release.channel)}`,
											onClick: () => {
												ui.preferences.setChannel(release.channel);
											},
											children: selected ? t("panel.selectedChannel") : t("panel.selectChannel")
										})
									]
								}, release.channel);
							})]
						}),
						warning !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dus-warning",
							children: [
								t("panel.error"),
								": ",
								warning
							]
						}),
						snapshot.error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dus-warning",
							children: [
								t("panel.error"),
								": ",
								snapshot.error
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dus-actions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dus-action",
									type: "button",
									disabled: snapshot.loading,
									onClick: () => {
										ui.status.refresh(void 0, preferences.cacheTtlMinutes);
									},
									children: snapshot.loading ? t("panel.checking") : t("panel.check")
								}),
								status !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									className: "dus-action",
									href: status.changelogUrl,
									target: "_blank",
									rel: "noreferrer",
									children: t("panel.releaseNotes")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dus-action",
									type: "button",
									disabled: switchingChannel || status === null,
									onClick: () => {
										copy();
									},
									children: t("panel.copy")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dus-command-label",
							children: t("panel.command")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
							ref: commandRef,
							className: "dus-command",
							tabIndex: 0,
							children: command
						}),
						copyMessage !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dus-copy-message",
							role: "status",
							children: copyMessage
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dus-note",
							children: t("panel.commandNote")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dus-note",
							children: t("panel.readOnly")
						})
					]
				})]
			});
		}
		/** Separate setting page: disables only this plugin's own rendering. */
		function UpdateSettings({ ui }) {
			const preferences = useObservable(ui.preferences);
			const snapshot = useObservable(ui.status);
			const [showGuidance, setShowGuidance] = React.useState(false);
			const previews = snapshot.status?.channels.filter((release) => release.channel !== "latest") ?? [];
			const channelOptions = snapshot.status === null ? [{ channel: preferences.channel }] : visibleChannelReleases(snapshot.status);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dus-settings",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "dus-settings-heading",
						children: t("settings.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dus-settings-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dus-settings-toggle",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: preferences.sidebarEnabled,
									disabled: !preferences.writable,
									onChange: (event) => {
										ui.preferences.setSidebarEnabled(event.currentTarget.checked);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.sidebar") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dus-settings-hint",
								children: t("settings.sidebarHint")
							}),
							!preferences.writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dus-settings-hint",
								children: t("settings.readonly")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dus-settings-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dus-settings-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.channel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "dus-channel-select",
									value: preferences.channel,
									disabled: !preferences.writable,
									onChange: (event) => {
										ui.preferences.setChannel(event.currentTarget.value);
									},
									children: channelOptions.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: option.channel,
										children: channelLabel(option.channel)
									}, option.channel))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dus-settings-hint",
								children: t("settings.channelHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dus-settings-hint",
								children: [
									t("panel.current"),
									": ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: snapshot.status?.currentVersion ?? "…" })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dus-settings-hint",
								children: t("preview.follow")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dus-action",
								type: "button",
								"aria-expanded": showGuidance,
								onClick: () => {
									setShowGuidance(!showGuidance);
								},
								children: t(showGuidance ? "preview.close" : "preview.open")
							}),
							showGuidance && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								"aria-label": t("preview.open"),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dus-warning",
										children: t("preview.risk")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dus-action",
										type: "button",
										disabled: snapshot.loading,
										onClick: () => {
											ui.status.refresh(void 0, preferences.cacheTtlMinutes);
										},
										children: t(snapshot.loading ? "panel.checking" : "panel.check")
									}),
									snapshot.error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										role: "alert",
										children: snapshot.error
									}),
									previews.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("preview.unavailable") }),
									previews.map((release) => {
										const status = snapshot.status;
										const command = previewCommand(status, release.version);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dus-settings-card",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
													channelLabel(release.channel),
													" · ",
													t("preview.target"),
													": ",
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: release.version ?? t("panel.notChecked") })
												] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: compatibilityLabel(release.compatibility) }),
												release.version === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("preview.unavailable") }) : release.version === status.currentVersion ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("preview.same") }) : command !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("panel.command") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
													className: "dus-command",
													tabIndex: 0,
													children: command
												})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("preview.manual") })
											]
										}, release.channel);
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dus-note",
										children: t("panel.commandNote")
									})
								]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/contract.ts
		/** Minimal structural client faces — runtime services stay owned by DSH. */
		function errorMessage(error) {
			return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 220) || "unknown error";
		}
		function stringOrNull(value) {
			return typeof value === "string" ? value : null;
		}
		function warningOf(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
			const record = value;
			if (record.code === "registry-unavailable" && typeof record.detail === "string") return {
				code: record.code,
				detail: record.detail
			};
			if (record.code === "channel-unavailable" && isReleaseChannel(record.channel)) return {
				code: record.code,
				channel: record.channel
			};
			if (record.code === "version-incomparable" && typeof record.currentVersion === "string" && isReleaseChannel(record.channel) && typeof record.selectedVersion === "string") return {
				code: record.code,
				currentVersion: record.currentVersion,
				channel: record.channel,
				selectedVersion: record.selectedVersion
			};
			if (record.code === "preview-unverified" && isReleaseChannel(record.channel) && typeof record.version === "string") return {
				code: record.code,
				channel: record.channel,
				version: record.version
			};
			if (record.code === "stale-schemastery") {
				const version = record.version === null ? null : stringOrNull(record.version);
				const nodeModulesDir = record.nodeModulesDir === null ? null : stringOrNull(record.nodeModulesDir);
				const path = stringOrNull(record.path);
				if (path !== null && (record.version === null || version !== null) && (record.nodeModulesDir === null || nodeModulesDir !== null)) return {
					code: record.code,
					version,
					path,
					nodeModulesDir
				};
			}
		}
		/** Reject malformed RPC output before it reaches a slot component. */
		function updateStatusOf(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
			const record = value;
			if (typeof record.currentVersion !== "string" || typeof record.hasUpdate !== "boolean" || typeof record.cached !== "boolean" || typeof record.installKind !== "string" || typeof record.upgradeCommand !== "string" || typeof record.releaseUrl !== "string" || typeof record.changelogUrl !== "string" || typeof record.packageName !== "string" || !isReleaseChannel(record.channel) || !Array.isArray(record.channels) || record.canApplyInPlace !== false) return void 0;
			if (!(record.installKind === "npm-global" || record.installKind === "pnpm-global" || record.installKind === "source-checkout" || record.installKind === "unknown")) return void 0;
			const latestVersion = record.latestVersion === null ? null : stringOrNull(record.latestVersion);
			const checkedAt = record.checkedAt === null ? null : stringOrNull(record.checkedAt);
			const warning = record.warning === null ? null : stringOrNull(record.warning);
			const warningKind = record.warningKind === "failure" || record.warningKind === "notice" ? record.warningKind : void 0;
			const publishedAt = record.publishedAt === null ? null : stringOrNull(record.publishedAt);
			if (record.latestVersion !== null && latestVersion === null || record.checkedAt !== null && checkedAt === null || record.warning !== null && warning === null || record.publishedAt !== null && publishedAt === null) return void 0;
			const warnings = [];
			if (record.warnings !== void 0) {
				if (!Array.isArray(record.warnings)) return void 0;
				for (const raw of record.warnings) {
					const parsed = warningOf(raw);
					if (parsed === void 0) return void 0;
					warnings.push(parsed);
				}
			}
			const channels = [];
			for (const raw of record.channels) {
				if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
				const item = raw;
				const version = item.version === null ? null : stringOrNull(item.version);
				const channelPublishedAt = item.publishedAt === null ? null : stringOrNull(item.publishedAt);
				if (!isReleaseChannel(item.channel) || item.version !== null && version === null || item.publishedAt !== null && channelPublishedAt === null || item.compatibility !== "verified" && item.compatibility !== "unverified" && item.compatibility !== "incompatible") return void 0;
				channels.push({
					channel: item.channel,
					version,
					publishedAt: channelPublishedAt,
					compatibility: item.compatibility
				});
			}
			return {
				currentVersion: record.currentVersion,
				latestVersion,
				hasUpdate: record.hasUpdate,
				cached: record.cached,
				checkedAt,
				warning,
				warningKind,
				warnings,
				installKind: record.installKind,
				upgradeCommand: record.upgradeCommand,
				releaseUrl: record.releaseUrl,
				changelogUrl: record.changelogUrl,
				publishedAt,
				packageName: record.packageName,
				channel: record.channel,
				channels,
				canApplyInPlace: false
			};
		}
		//#endregion
		//#region src/client/stores.ts
		/** Small observable stores shared by the independent sidebar and overlay slots. */
		const INITIAL_STATUS = {
			status: null,
			loading: true,
			error: null
		};
		var StatusStore = class {
			connection;
			snapshot = INITIAL_STATUS;
			listeners = /* @__PURE__ */ new Set();
			inFlight;
			stopped = false;
			constructor(connection) {
				this.connection = connection;
			}
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			/** First mount reads the Host's cached status; it never starts a browser timer. */
			async load(cacheTtlMinutes = 360) {
				await this.request(false, this.snapshot.status?.channel ?? "latest", cacheTtlMinutes);
			}
			/** User gesture only: force the Host to bypass TTL (while retaining single-flight). */
			async refresh(channel = this.snapshot.status?.channel ?? "latest", cacheTtlMinutes = 360) {
				await this.request(true, channel, cacheTtlMinutes);
			}
			/** Channel selection re-projects the Host cache; it is not a forced refresh. */
			async selectChannel(channel, cacheTtlMinutes = 360) {
				for (let attempts = 0; attempts < 3 && !this.stopped && this.snapshot.status?.channel !== channel; attempts += 1) {
					const pending = this.inFlight;
					if (pending !== void 0 && !await pending) return;
					if (this.stopped || this.snapshot.status?.channel === channel) return;
					if (!await this.request(false, channel, cacheTtlMinutes)) return;
				}
			}
			stop() {
				this.stopped = true;
				this.listeners.clear();
			}
			publish(next) {
				if (this.stopped) return;
				this.snapshot = next;
				for (const listener of this.listeners) listener();
			}
			request(force, channel, cacheTtlMinutes) {
				if (this.inFlight !== void 0) return this.inFlight;
				const rpc = this.connection.rpc;
				if (rpc === void 0 || typeof rpc.call !== "function") {
					this.publish({
						...this.snapshot,
						loading: false,
						error: "DSH connection RPC is unavailable"
					});
					return Promise.resolve(false);
				}
				this.publish({
					...this.snapshot,
					loading: true,
					error: null
				});
				const run = (async () => {
					try {
						const endpoint = force ? UPDATE_ENDPOINTS.checkUpdate : UPDATE_ENDPOINTS.getStatus;
						const ttl = isCacheTtlMinutes(cacheTtlMinutes) ? cacheTtlMinutes : 360;
						const raw = await rpc.call(UPDATE_STATUS_CHANNEL, endpoint, force ? {
							force: true,
							channel,
							cacheTtlMinutes: ttl
						} : {
							channel,
							cacheTtlMinutes: ttl
						});
						if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid update-status RPC response");
						const envelope = raw;
						if (envelope.ok !== true) throw new Error(typeof envelope.error?.message === "string" ? envelope.error.message : "update-status RPC failed");
						const status = updateStatusOf(envelope.value);
						if (status === void 0) throw new Error("invalid update-status payload");
						this.publish({
							status,
							loading: false,
							error: null
						});
						return true;
					} catch (error) {
						this.publish({
							...this.snapshot,
							loading: false,
							error: errorMessage(error)
						});
						return false;
					}
				})();
				this.inFlight = run;
				run.finally(() => {
					if (this.inFlight === run) this.inFlight = void 0;
				});
				return run;
			}
		};
		const INITIAL_PREFERENCES = {
			sidebarEnabled: true,
			channel: "latest",
			cacheTtlMinutes: 360,
			writable: false,
			status: "loading"
		};
		var PreferencesStore = class {
			snapshot = INITIAL_PREFERENCES;
			listeners = /* @__PURE__ */ new Set();
			scope;
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			attach(scope) {
				this.scope = scope;
				const sync = () => {
					const raw = scope.getSnapshot();
					const value = raw.value !== null && typeof raw.value === "object" && !Array.isArray(raw.value) ? raw.value : {};
					const status = raw.status === "ready" || raw.status === "unavailable" ? raw.status : "loading";
					this.publish({
						sidebarEnabled: value.sidebarEnabled !== false,
						channel: isReleaseChannel(value.channel) ? value.channel : "latest",
						cacheTtlMinutes: isCacheTtlMinutes(value.cacheTtlMinutes) ? value.cacheTtlMinutes : 360,
						writable: raw.writable === true,
						status
					});
				};
				sync();
				return scope.subscribe(sync);
			}
			setSidebarEnabled(enabled) {
				const previous = this.snapshot;
				this.publish({
					...previous,
					sidebarEnabled: enabled
				});
				const scope = this.scope;
				if (scope === void 0 || !previous.writable) return;
				scope.set("sidebarEnabled", enabled).catch(() => {
					try {
						const raw = scope.getSnapshot();
						const value = raw.value !== null && typeof raw.value === "object" && !Array.isArray(raw.value) ? raw.value : {};
						this.publish({
							sidebarEnabled: value.sidebarEnabled !== false,
							channel: isReleaseChannel(value.channel) ? value.channel : "latest",
							cacheTtlMinutes: isCacheTtlMinutes(value.cacheTtlMinutes) ? value.cacheTtlMinutes : 360,
							writable: raw.writable === true,
							status: raw.status === "ready" || raw.status === "unavailable" ? raw.status : "loading"
						});
					} catch {
						this.publish(previous);
					}
				});
			}
			setChannel(channel) {
				const previous = this.snapshot;
				this.publish({
					...previous,
					channel
				});
				const scope = this.scope;
				if (scope === void 0 || !previous.writable) return;
				scope.set("channel", channel).catch(() => {
					this.publish(previous);
				});
			}
			setCacheTtlMinutes(cacheTtlMinutes) {
				if (!isCacheTtlMinutes(cacheTtlMinutes)) return;
				const previous = this.snapshot;
				this.publish({
					...previous,
					cacheTtlMinutes
				});
				const scope = this.scope;
				if (scope === void 0 || !previous.writable) return;
				scope.set("cacheTtlMinutes", cacheTtlMinutes).catch(() => {
					this.publish(previous);
				});
			}
			publish(next) {
				const previous = this.snapshot;
				if (previous.sidebarEnabled === next.sidebarEnabled && previous.channel === next.channel && previous.cacheTtlMinutes === next.cacheTtlMinutes && previous.writable === next.writable && previous.status === next.status) return;
				this.snapshot = next;
				for (const listener of this.listeners) listener();
			}
		};
		/** Open state also retains its trigger, so the desktop card sits beside it. */
		var PanelStore = class {
			snapshot = {
				open: false,
				origin: "brand"
			};
			listeners = /* @__PURE__ */ new Set();
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			toggle(origin) {
				const open = !(this.snapshot.open && this.snapshot.origin === origin);
				this.set({
					open,
					origin
				});
			}
			close() {
				this.set({
					...this.snapshot,
					open: false
				});
			}
			set(next) {
				if (this.snapshot.open === next.open && this.snapshot.origin === next.origin) return;
				this.snapshot = next;
				for (const listener of this.listeners) listener();
			}
		};
		/**
		* The one settings namespace, which on DSH 0.1.7 IS the Loader entry id in
		* `cordis.patch.yml`: the Host half's volatile `Config` fields are projected as
		* that entry's form, and the browser half addresses the same id through
		* `ctx.configForms.get(...)`.
		*/
		const SETTINGS_NAMESPACE = PLUGIN_ID$1;
		//#endregion
		//#region src/client/settings/hostDirectScope.ts
		/** A refused namespace write; `code` keeps the Host's own diagnosis. */
		var SettingsWriteFailure = class extends Error {
			code;
			constructor(code, message) {
				super(message === void 0 || message === "" ? code : message);
				this.name = "SettingsWriteFailure";
				this.code = code;
			}
		};
		function isRecord(value) {
			return typeof value === "object" && value !== null;
		}
		/**
		* Guard: does this value look like the `remote.settings` namespace face?
		* Applied to a bare service object (`ctx.get('remote.settings')` or a payload
		* member), and it never calls anything.
		*/
		function settingsRemoteFace(value) {
			if (!isRecord(value)) return void 0;
			if (typeof value.describe !== "function" || typeof value.mutate !== "function") return void 0;
			return value;
		}
		/**
		* Guard: read the `remote.settings` face off an injection payload.
		*
		* The payload a `ctx.inject(['remote.settings'], …)` callback receives exposes
		* the LITERAL service key. Reading the dotted PARENT off that injected context
		* (`payload.remote`) throws `cannot get property "remote" without inject` — a
		* throw that used to abort a whole wiring callback on a LAN page. So the literal
		* key is read FIRST and every read is contained; the nested
		* (`payload.remote.settings`) shape is only a fallback for a plain object
		* payload. Both absence and refusal answer `undefined`.
		*/
		function settingsRemoteOf(raw) {
			if (!isRecord(raw)) return void 0;
			try {
				const direct = settingsRemoteFace(raw["remote.settings"]);
				if (direct !== void 0) return direct;
			} catch {}
			try {
				const remote = raw.remote;
				if (isRecord(remote)) return settingsRemoteFace(remote.settings);
			} catch {}
		}
		/**
		* Guard: subscribe to the Host's settings-document invalidation on the Remote
		* service object (`remote.$on`). Returns undefined when the service exposes no
		* event seam — the preferences then refresh on reconnect only.
		*/
		function settingsInvalidationsOf(service) {
			if (!isRecord(service)) return void 0;
			const on = service.$on;
			if (typeof on !== "function") return void 0;
			return (listener) => {
				const dispose = on.call(service, "settings/document-updated", listener);
				return typeof dispose === "function" ? dispose : () => {};
			};
		}
		function cloneOps(ops) {
			try {
				return structuredClone(ops);
			} catch {
				return ops.map((op) => op.op === "set" ? {
					op: "set",
					path: [...op.path],
					value: op.value
				} : {
					op: "unset",
					path: [...op.path]
				});
			}
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function sameSnapshot$1(a, b) {
			return a.status === b.status && a.revision === b.revision && a.writable === b.writable && a.mode === b.mode && a.value === b.value && a.base === b.base && a.user === b.user;
		}
		function readySnapshot(row, writable) {
			return {
				status: "ready",
				value: row.value,
				base: row.base,
				user: row.user,
				revision: row.revision,
				writable,
				mode: "host"
			};
		}
		function unavailableSnapshot(writable) {
			return {
				status: "unavailable",
				value: void 0,
				base: void 0,
				user: void 0,
				revision: void 0,
				writable,
				mode: "host"
			};
		}
		/**
		* Build the direct Host settings scope for one namespace.
		*
		* Snapshot semantics mirror the official per-namespace derivation: a namespace
		* row answers `ready` with the resolved section, its `base`/`user` layers and its
		* revision fence, and the document's `writable` decides editability. A row the
		* Host does not serve answers `unavailable`; a refused read keeps the last
		* confirmed document and reports `unavailable` only while it has never held one.
		*
		* Writes are serialized in issue order, fenced by the latest known revision and
		* REJECT with {@link SettingsWriteFailure} on a Host refusal — that rejection is
		* what makes the settings page surface a conflict instead of pretending the edit
		* landed (the official scope resolves on `!ok` after its recovery read).
		*
		* @param remote - the `remote.settings` face of the page's Remote service.
		* @param namespace - the settings namespace this scope derives from.
		* @returns the scope plus its load/dispose seams.
		*/
		function createHostDirectScope(remote, namespace) {
			let snapshot = {
				status: "loading",
				value: void 0,
				base: void 0,
				user: void 0,
				revision: void 0,
				writable: false,
				mode: "host"
			};
			let held;
			let error;
			let disposed = false;
			let tail = Promise.resolve();
			const listeners = /* @__PURE__ */ new Set();
			const publish = (next) => {
				if (disposed || sameSnapshot$1(next, snapshot)) return;
				snapshot = next;
				for (const listener of [...listeners]) try {
					listener();
				} catch {}
			};
			const adopt = (next) => {
				if (next.status === "ready") held = next;
				publish(next);
			};
			async function load() {
				if (disposed) return;
				let outcome;
				try {
					outcome = await remote.describe();
				} catch (caught) {
					outcome = {
						ok: false,
						error: { message: messageOf(caught) }
					};
				}
				if (disposed) return;
				if (!outcome.ok) {
					error = outcome.error?.message ?? outcome.error?.code ?? "settings/describe-failed";
					publish(held ?? unavailableSnapshot(snapshot.writable));
					return;
				}
				error = void 0;
				const view = outcome.value;
				const writable = view.writable === true;
				const row = Array.isArray(view.namespaces) ? view.namespaces.find((candidate) => candidate.ns === namespace) : void 0;
				if (row === void 0 || typeof row.revision !== "number") {
					publish(unavailableSnapshot(writable));
					return;
				}
				adopt(readySnapshot(row, writable));
			}
			/** Fold one write answer's namespace row in without a second wire read. */
			function fold(row, writable) {
				if (typeof row.revision !== "number") return;
				adopt(readySnapshot(row, writable));
			}
			function mutate(ops, expectedRevision) {
				const owned = cloneOps(ops);
				const run = tail.then(async () => {
					if (disposed) throw new SettingsWriteFailure("settings/unavailable");
					const revision = expectedRevision ?? snapshot.revision;
					let outcome;
					try {
						outcome = revision === void 0 ? await remote.mutate(namespace, owned) : await remote.mutate(namespace, owned, revision);
					} catch (caught) {
						await load();
						throw new SettingsWriteFailure("settings/unreachable", messageOf(caught));
					}
					if (outcome.ok) {
						fold(outcome.value, true);
						return;
					}
					await load();
					throw new SettingsWriteFailure(outcome.error?.code ?? "settings/unknown", outcome.error?.message);
				});
				tail = run.then(() => void 0, () => void 0);
				return run;
			}
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set: (field, value) => mutate([{
					op: "set",
					path: [field],
					value
				}]),
				load,
				dispose() {
					disposed = true;
					listeners.clear();
				},
				lastError: () => error
			};
		}
		//#endregion
		//#region src/client/settings/configFormScope.ts
		/**
		* Guard: read the `configForms` face off an injection payload.
		*
		* The literal service key is read inside a `try`, because an injected payload
		* proxy can refuse a member read (the failure this plugin already hit on the
		* dotted `remote.settings` parent). Absence and refusal both answer
		* `undefined`, which leaves the channel on its direct Host path.
		*
		* @param raw - the payload a `ctx.inject(['configForms'], …)` callback received.
		* @returns the binder face, or undefined when this page has no settings forms.
		*/
		function configFormsOf(raw) {
			if (raw === null || typeof raw !== "object") return void 0;
			let face;
			try {
				face = raw["configForms"];
			} catch {
				return;
			}
			if (face === null || typeof face !== "object") return void 0;
			if (typeof face.get !== "function") return void 0;
			return face;
		}
		/**
		* Project one official config form onto the plugin's settings-scope contract.
		*
		* @param form - the shared form for the plugin's own Loader entry id.
		* @returns a scope the preferences store and the channel selection can use as-is.
		*/
		function configFormScope(form) {
			return {
				getSnapshot() {
					const snapshot = form.getSnapshot();
					return {
						status: snapshot.status,
						value: snapshot.value,
						base: snapshot.base,
						user: snapshot.user,
						revision: snapshot.revision,
						writable: snapshot.writable,
						mode: snapshot.mode
					};
				},
				subscribe(listener) {
					return form.subscribe(listener);
				},
				async set(field, value) {
					let accepted;
					try {
						accepted = await form.set(field, value);
					} catch (error) {
						throw new SettingsWriteFailure("settings/unreachable", error instanceof Error ? error.message : String(error));
					}
					if (!accepted) throw new SettingsWriteFailure("settings/conflict");
				}
			};
		}
		//#endregion
		//#region src/client/settings/settingsChannel.ts
		/** Snapshot used while no channel has answered yet. */
		const LOADING_SNAPSHOT = Object.freeze({
			status: "loading",
			value: void 0,
			base: void 0,
			user: void 0,
			revision: void 0,
			writable: false,
			mode: "host"
		});
		function sameSnapshot(a, b) {
			return a.status === b.status && a.revision === b.revision && a.writable === b.writable && a.mode === b.mode && a.value === b.value && a.base === b.base && a.user === b.user;
		}
		/** Ask a channel for its first/next read; a refusal surfaces as a snapshot, never a throw. */
		function loadSource(source) {
			const loadable = source;
			if (loadable === void 0 || typeof loadable.load !== "function") return Promise.resolve();
			return Promise.resolve(loadable.load()).then(() => void 0, () => void 0);
		}
		function createSettingsChannel(options) {
			let official;
			let direct;
			let active;
			let snapshot = LOADING_SNAPSHOT;
			let disposed = false;
			const disposers = [];
			const listeners = /* @__PURE__ */ new Set();
			const notify = () => {
				for (const listener of [...listeners]) try {
					listener();
				} catch {}
			};
			const publish = (next) => {
				if (disposed || sameSnapshot(next, snapshot)) return;
				snapshot = next;
				notify();
			};
			const select = () => {
				if (official !== void 0 && official.getSnapshot().status !== "unavailable") return official;
				if (direct === void 0) {
					try {
						direct = options.openDirect();
					} catch {
						direct = void 0;
					}
					if (direct !== void 0) {
						try {
							disposers.push(direct.subscribe(() => {
								if (active === direct) publish(direct.getSnapshot());
							}));
						} catch {}
						loadSource(direct);
					}
				}
				return direct ?? official;
			};
			const reselect = () => {
				if (disposed) return;
				const next = select();
				if (next !== active) {
					active = next;
					publish(next?.getSnapshot() ?? LOADING_SNAPSHOT);
					return;
				}
				publish(next?.getSnapshot() ?? LOADING_SNAPSHOT);
			};
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set(field, value) {
					const source = active;
					if (source === void 0) return Promise.reject(/* @__PURE__ */ new Error("dsh-update-status: settings channel is unavailable"));
					return source.set(field, value);
				},
				setOfficial(scope) {
					if (disposed) return;
					official = scope;
					if (scope !== void 0) try {
						disposers.push(scope.subscribe(() => {
							reselect();
						}));
					} catch {}
					reselect();
				},
				refresh: reselect,
				reload() {
					if (active === void 0 || active === official) return;
					loadSource(active);
				},
				dispose() {
					disposed = true;
					listeners.clear();
					for (const dispose of disposers.splice(0)) try {
						dispose();
					} catch {}
					const disposable = active;
					if (disposable !== void 0 && typeof disposable.dispose === "function") try {
						disposable.dispose();
					} catch {}
				}
			};
		}
		//#endregion
		//#region src/client/styles.ts
		/** Plugin-owned CSS only; no shell DOM selection or official SVG manipulation. */
		const UPDATE_STATUS_CSS = `
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
.dus-badge:focus-visible,.dus-footer-button:focus-visible,.dus-action:focus-visible,.dus-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
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
.dus-footer-button{align-items:center;background:transparent;border:0;border-radius:10px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;height:44px;justify-content:center;min-height:44px;min-width:44px;padding:0;position:relative;touch-action:manipulation;width:44px}
.dus-footer-button:hover{background:var(--dsw-alias-button-floating-hover);color:var(--dsw-alias-label-primary)}
.dus-footer-icon{font-size:18px;line-height:1}
.dus-footer-dot{border:1.5px solid var(--dsw-specific-sidebar-fill);position:absolute;right:9px;top:9px}
.dus-overlay-root{background:transparent;border:0;color:inherit;height:100dvh;inset:0;margin:0;max-height:none;max-width:none;padding:0;pointer-events:none;position:fixed;width:100vw}
.dus-overlay-root::backdrop{background:transparent}
.dus-backdrop{background:transparent;inset:0;pointer-events:auto;position:absolute}
.dus-panel{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:var(--dsw-elevation-panel);box-sizing:border-box;color:var(--dsw-alias-label-primary);max-height:min(640px,calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)));overflow:auto;padding:14px;pointer-events:auto;position:absolute;top:12px;width:min(390px,calc(100vw - 24px));z-index:1}
.dus-panel[data-origin=brand]{left:min(292px,calc(100vw - 402px))}
.dus-panel[data-origin=rail]{left:min(68px,calc(100vw - 402px))}
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
@media (max-width:640px),(hover:none) and (pointer:coarse){.dus-panel[data-origin]{border-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0;bottom:0;left:0;right:0;max-height:min(78dvh,calc(100dvh - env(safe-area-inset-top)));padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));position:fixed;top:auto;width:100vw}.dus-footer-button{height:48px;min-height:48px;min-width:48px;width:48px}.dus-action{min-height:40px;line-height:38px}.dus-close{height:40px;min-height:40px;min-width:40px;width:40px}}
`;
		//#endregion
		//#region src/client/index.ts
		const PLUGIN_ID = "dsh-update-status";
		const CSS_TAG_ID = `${PLUGIN_ID}/styles`;
		function installStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = UPDATE_STATUS_CSS;
			document.head.appendChild(tag);
			return () => {
				const live = document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`);
				if (live?.parentNode !== void 0 && live?.parentNode !== null) live.parentNode.removeChild(live);
			};
		}
		function connectionOf(ctx) {
			try {
				const candidate = ctx.get("connection");
				return candidate !== null && typeof candidate === "object" ? candidate : {};
			} catch {
				return {};
			}
		}
		function apply(ctx) {
			const status = new StatusStore(connectionOf(ctx));
			const preferences = new PreferencesStore();
			const ui = {
				status,
				preferences,
				panel: new PanelStore()
			};
			const disposers = [];
			let stopped = false;
			/** Own a subscription raised from an injection callback; release after teardown at once. */
			const own = (dispose) => {
				if (typeof dispose !== "function") return;
				if (stopped) {
					try {
						dispose();
					} catch {}
					return;
				}
				disposers.push(dispose);
			};
			let remoteSettings;
			/** Resolve the direct channel's Remote face; `ctx.get` covers a payload we could not read. */
			const directRemote = () => {
				if (remoteSettings !== void 0) return remoteSettings;
				try {
					remoteSettings = settingsRemoteFace(ctx.get("remote.settings"));
				} catch {}
				return remoteSettings;
			};
			const channel = createSettingsChannel({ openDirect: () => {
				const remote = directRemote();
				return remote === void 0 ? void 0 : createHostDirectScope(remote, SETTINGS_NAMESPACE);
			} });
			ctx.effect(() => {
				const disposeStyles = installStyles();
				const detach = preferences.attach(channel);
				let selected = status.getSnapshot().status?.channel ?? "latest";
				const syncPreferences = () => {
					const next = preferences.getSnapshot();
					if (next.channel !== selected) {
						selected = next.channel;
						status.selectChannel(selected, next.cacheTtlMinutes);
					}
				};
				syncPreferences();
				const unsubscribe = preferences.subscribe(syncPreferences);
				status.load(preferences.getSnapshot().cacheTtlMinutes);
				return () => {
					stopped = true;
					unsubscribe();
					detach();
					for (const dispose of disposers.splice(0)) try {
						dispose();
					} catch {}
					channel.dispose();
					status.stop();
					disposeStyles();
				};
			}, "dsh-update-status: styles, settings channel and first status read");
			try {
				ctx.inject(["configForms"], (raw) => {
					try {
						const forms = configFormsOf(raw);
						if (forms === void 0) return;
						channel.setOfficial(configFormScope(forms.get(SETTINGS_NAMESPACE)));
					} catch {}
				});
			} catch {}
			try {
				ctx.inject(["remote.settings"], (raw) => {
					try {
						remoteSettings = settingsRemoteOf(raw) ?? remoteSettings;
						channel.refresh();
						const invalidations = settingsInvalidationsOf(ctx.get("remote"));
						if (invalidations !== void 0) own(invalidations(() => channel.reload()));
					} catch {}
				});
			} catch {}
			if (typeof ctx.on === "function") try {
				own(ctx.on("connection/reset", () => channel.reload()));
			} catch {}
			ctx.slots.inject("sidebar.brand.name", () => ctx.slots.register({
				name: "sidebar.brand.name",
				priority: -10
			}, () => BrandName({ ui })));
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-update-status",
				order: 40
			}, (props) => FooterAction({
				wide: props.wide,
				ui
			})));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-update-status",
				order: 40
			}, () => UpdatePanel({ ui })));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-update-status",
				order: 80,
				label: () => t("settings.title")
			}, () => UpdateSettings({ ui })));
		}
		module.exports = {
			name: PLUGIN_ID,
			inject: ["slots", "connection"],
			apply
		};
		//#endregion
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map