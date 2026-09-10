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
		* The selected channel and stable return path are mandatory; other rows must
		* represent a version that differs from both the running DSH and earlier rows.
		*/
		function visibleChannelReleases(status) {
			const ordered = [...status.channels].sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel]);
			const mandatory = /* @__PURE__ */ new Set(["latest", status.channel]);
			const visible = ordered.filter((release) => mandatory.has(release.channel));
			const seenVersions = new Set(visible.map((release) => release.version).filter((version) => version !== null));
			for (const release of ordered) {
				if (mandatory.has(release.channel) || release.version === null || release.version === status.currentVersion) continue;
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
		* `harness.handle` / `host.call` are dynamic-Cordis-only closure APIs in DSH
		* 0.1.2-rc.1. The endpoint vocabulary remains deliberately small and private
		* to this plugin channel.
		*/
		const PLUGIN_ID$1 = "dsh-update-status";
		const PACKAGE_NAME = "@deepseek-ai/dsh";
		const UPDATE_STATUS_CHANNEL = "/dsh-update-status";
		/** Exact DSH release this Phase-1 bundle declares compatible in package.json. */
		const STATIC_COMPATIBLE_VERSION = "0.1.2-rc.1";
		const RELEASE_CHANNELS = [
			"latest",
			"next",
			"alpha"
		];
		const MAX_CACHE_TTL_MINUTES = 1440;
		function isCacheTtlMinutes(value) {
			return typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 1440;
		}
		const UPDATE_ENDPOINTS = {
			getStatus: "get-status",
			checkUpdate: "check-update"
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
		function t(key) {
			const entry = DICTIONARY[key];
			if (entry === void 0) return key;
			return entry[languageOf()] ?? entry.en;
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
			if (error !== null || status?.warning !== null) return status?.hasUpdate === true ? "update" : "problem";
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
			const version = snapshot.status?.currentVersion ?? "…";
			const activate = (event) => {
				event.preventDefault();
				event.stopPropagation();
				const target = event.currentTarget;
				if (target instanceof HTMLElement) target.blur();
				if (ui.canManage) ui.panel.toggle("brand");
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
					role: ui.canManage ? "button" : void 0,
					tabIndex: ui.canManage ? 0 : void 0,
					"aria-label": badgeLabel(snapshot.status, snapshot.loading, snapshot.error),
					"aria-disabled": ui.canManage ? void 0 : true,
					title: badgeLabel(snapshot.status, snapshot.loading, snapshot.error),
					onClick: ui.canManage ? activate : void 0,
					onKeyDown: ui.canManage ? onKeyDown : void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dus-badge-version",
						children: shortVersion(version)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dus-dot",
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
				disabled: !ui.canManage,
				onClick: () => {
					ui.panel.toggle("rail");
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dus-footer-icon",
					"aria-hidden": "true",
					children: "↟"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dus-dot dus-footer-dot",
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
			if (status?.warning !== null && status?.warning !== void 0) return {
				kind: "warning",
				text: status.warning
			};
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
		/** Full detail is only opened from a loopback/local DSH UI surface. */
		function UpdatePanel({ ui }) {
			const panel = useObservable(ui.panel);
			const preferences = useObservable(ui.preferences);
			const snapshot = useObservable(ui.status);
			const commandRef = React.useRef(null);
			const dialogRef = React.useRef(null);
			const [copyMessage, setCopyMessage] = React.useState(null);
			const visible = panel.open && preferences.sidebarEnabled && ui.canManage;
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
			const summary = statusSummary(status, snapshot.loading, snapshot.error);
			const switchingChannel = status !== null && status.channel !== preferences.channel;
			const command = switchingChannel ? t("panel.switchingChannel") : status?.upgradeCommand ?? "—";
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
						status?.warning !== null && status?.warning !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dus-warning",
							children: [
								t("panel.error"),
								": ",
								status.warning
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
							ui.canManage && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dus-action",
								type: "button",
								"aria-expanded": showGuidance,
								onClick: () => {
									setShowGuidance(!showGuidance);
								},
								children: t(showGuidance ? "preview.close" : "preview.open")
							}),
							ui.canManage && showGuidance && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
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
		/** Reject malformed RPC output before it reaches a slot component. */
		function updateStatusOf(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
			const record = value;
			if (typeof record.currentVersion !== "string" || typeof record.hasUpdate !== "boolean" || typeof record.cached !== "boolean" || typeof record.installKind !== "string" || typeof record.upgradeCommand !== "string" || typeof record.releaseUrl !== "string" || typeof record.changelogUrl !== "string" || typeof record.packageName !== "string" || !isReleaseChannel(record.channel) || !Array.isArray(record.channels) || record.canApplyInPlace !== false) return void 0;
			if (!(record.installKind === "npm-global" || record.installKind === "pnpm-global" || record.installKind === "source-checkout" || record.installKind === "unknown")) return void 0;
			const latestVersion = record.latestVersion === null ? null : stringOrNull(record.latestVersion);
			const checkedAt = record.checkedAt === null ? null : stringOrNull(record.checkedAt);
			const warning = record.warning === null ? null : stringOrNull(record.warning);
			const publishedAt = record.publishedAt === null ? null : stringOrNull(record.publishedAt);
			if (record.latestVersion !== null && latestVersion === null || record.checkedAt !== null && checkedAt === null || record.warning !== null && warning === null || record.publishedAt !== null && publishedAt === null) return void 0;
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
			snapshot;
			allowRequests;
			listeners = /* @__PURE__ */ new Set();
			inFlight;
			stopped = false;
			constructor(connection, staticVersion = null) {
				this.connection = connection;
				this.allowRequests = staticVersion === null;
				this.snapshot = staticVersion === null ? INITIAL_STATUS : {
					status: {
						currentVersion: staticVersion,
						latestVersion: null,
						hasUpdate: false,
						cached: true,
						checkedAt: null,
						warning: null,
						installKind: "unknown",
						upgradeCommand: "",
						releaseUrl: "",
						changelogUrl: "",
						publishedAt: null,
						packageName: "@deepseek-ai/dsh",
						channel: "latest",
						channels: RELEASE_CHANNELS.map((channel) => ({
							channel,
							version: null,
							publishedAt: null,
							compatibility: "unverified"
						})),
						canApplyInPlace: false
					},
					loading: false,
					error: null
				};
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
				if (this.allowRequests) await this.request(false, this.snapshot.status?.channel ?? "latest", cacheTtlMinutes);
			}
			/** User gesture only: force the Host to bypass TTL (while retaining single-flight). */
			async refresh(channel = this.snapshot.status?.channel ?? "latest", cacheTtlMinutes = 360) {
				if (this.allowRequests) await this.request(true, channel, cacheTtlMinutes);
			}
			/** Channel selection re-projects the Host cache; it is not a forced refresh. */
			async selectChannel(channel, cacheTtlMinutes = 360) {
				if (!this.allowRequests) return;
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
		/** The one namespace name used by Host registration and browser binding. */
		const SETTINGS_NAMESPACE = PLUGIN_ID$1;
		//#endregion
		//#region src/client/styles.ts
		/** Plugin-owned CSS only; no shell DOM selection or official SVG manipulation. */
		const UPDATE_STATUS_CSS = `
.dus-brand-name{align-items:center;gap:8px;min-width:0;width:100%;display:flex}
.dus-brand-deepseek{font-size:15px;font-weight:650;letter-spacing:-.015em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dus-badge{align-items:center;gap:5px;background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;flex:0 0 auto;font-size:11px;font-variant-numeric:tabular-nums;line-height:20px;max-width:132px;outline:none;padding:0 8px;touch-action:manipulation;user-select:none}
.dus-badge:focus-visible,.dus-footer-button:focus-visible,.dus-action:focus-visible,.dus-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dus-badge:hover{background:var(--dsw-alias-button-floating-hover)}
.dus-badge[data-update=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dus-badge[data-error=true]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dus-badge-version{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dus-dot{background:currentColor;border-radius:50%;display:inline-block;flex:0 0 auto;height:6px;width:6px}
.dus-dot[data-update=true]{animation:dus-pulse 1.5s ease-in-out infinite;background:var(--dsw-alias-state-warn-primary)}
.dus-dot[data-loading=true]{animation:dus-pulse .9s ease-in-out infinite}
@keyframes dus-pulse{0%,100%{opacity:.45;transform:scale(.82)}50%{opacity:1;transform:scale(1.15)}}
@media (prefers-reduced-motion:reduce){.dus-dot[data-update=true],.dus-dot[data-loading=true]{animation:none}}
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
@media (max-width:640px),(hover:none) and (pointer:coarse){.dus-panel[data-origin]{border-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0;bottom:0;left:0;right:0;max-height:min(78dvh,calc(100dvh - env(safe-area-inset-top)));padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));position:fixed;top:auto;width:100vw}.dus-footer-button{height:48px;min-height:48px;min-width:48px;width:48px}.dus-badge{line-height:24px;min-height:28px}.dus-action{min-height:40px;line-height:38px}.dus-close{height:40px;min-height:40px;min-width:40px;width:40px}}
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
			const connection = connectionOf(ctx);
			const canManage = connection.isLoopback === true;
			const status = new StatusStore(connection, canManage ? null : STATIC_COMPATIBLE_VERSION);
			const preferences = new PreferencesStore();
			const ui = {
				status,
				preferences,
				panel: new PanelStore(),
				canManage
			};
			ctx.effect(() => {
				const disposeStyles = installStyles();
				if (canManage) status.load(preferences.getSnapshot().cacheTtlMinutes);
				return () => {
					status.stop();
					disposeStyles();
				};
			}, "dsh-update-status: style and first status read");
			ctx.inject(["settingsScope"], (raw) => {
				const binder = raw.settingsScope;
				if (binder === null || typeof binder !== "object" || typeof binder.bind !== "function") return;
				try {
					const scope = binder.bind({ namespace: SETTINGS_NAMESPACE });
					ctx.effect(() => {
						const detach = preferences.attach(scope);
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
						return () => {
							unsubscribe();
							detach();
						};
					}, "dsh-update-status: sidebar and channel preferences");
				} catch {}
			});
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