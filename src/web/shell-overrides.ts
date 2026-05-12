export const WEB_SHELL_OVERRIDES = String.raw`
    :root { --terminal-line-height: 1; --terminal-font-size: 12px; --terminal-xterm-padding: 0; --terminal-font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace; --accent-red: var(--red, #d33); }
    .content:has(.agent-page), .content:has(.messages-page), .content:has(.settings-page), .content:has(.workspaces-overview-page) { padding: 0; }
    .tab-content { height: 100%; overflow: hidden; }
    .terminal { height: 100%; overflow: hidden; }
    .terminal { position: relative; }
    .terminal-actions { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-bottom: 1px solid var(--terminal-border); background: var(--terminal-bar); color: #9ca3af; flex-shrink: 0; }
    .terminal-copy-status { color: #9ca3af; font-size: 11px; }
    .terminal-body { flex: 1 1 auto; height: auto; min-height: 0; position: relative; }
    .terminal-body { font-family: var(--terminal-font-family); }
    .terminal-exit-card { max-width: 720px; margin: 40px auto; padding: 18px; border: 1px solid var(--terminal-border); border-radius: 12px; background: color-mix(in srgb, var(--terminal-bar) 88%, #fff 12%); color: #d4d4d4; font-family: var(--font-ui); white-space: normal; }
    .terminal-exit-eyebrow { color: #9ca3af; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .terminal-exit-card h2 { margin: 6px 0 8px; color: #fff; font-size: 18px; }
    .terminal-exit-card p { margin: 12px 0 0; }
    .terminal-exit-cta { color: #fff; font-weight: 700; }
    .terminal-exit-meta { display: flex; flex-wrap: wrap; gap: 8px; color: #9ca3af; font-family: var(--font-mono); font-size: 11px; }
    .terminal-exit-output { margin-top: 14px; }
    .terminal-exit-output summary { cursor: pointer; color: #fff; font-size: 12px; font-weight: 700; }
    .terminal-exit-output pre { max-height: 260px; overflow: auto; margin: 10px 0 0; padding: 12px; border: 1px solid var(--terminal-border); border-radius: 8px; background: var(--terminal); color: #d4d4d4; font-family: var(--terminal-font-family); font-size: var(--terminal-font-size); line-height: var(--terminal-fallback-line-height); white-space: pre-wrap; }
    .terminal.xterm-enabled .terminal-body { display: flex; overflow: hidden; }
    .terminal-body .xterm { flex: 1 1 auto; min-width: 0; min-height: 0; height: 100% !important; }
    .terminal-body .xterm { font-family: var(--terminal-font-family); line-height: 1; }
    .terminal-body, .terminal-body .xterm-screen, .terminal-body .xterm-viewport { touch-action: pan-y; overscroll-behavior: contain; }
    .terminal .xterm-link-layer { pointer-events: none; }
    .terminal-body .xterm-screen,
    .terminal-body .xterm-viewport { width: 100% !important; }
    .terminal-body .xterm { will-change: transform; transform: translateZ(0); }
    :root[data-xterm-gpu-layer="off"] .terminal-body .xterm { will-change: auto; transform: none; }
    .terminal-debug-overlay { position: absolute; right: 10px; bottom: 42px; z-index: 40; max-width: min(520px, calc(100% - 20px)); padding: 8px 10px; border: 1px solid rgb(148 163 184 / .35); border-radius: 8px; background: rgb(15 23 42 / .86); color: #dbeafe; font-family: var(--font-mono); font-size: 11px; line-height: 1.35; pointer-events: none; box-shadow: 0 12px 30px rgb(0 0 0 / .28); }
    .special-keys-icon { position: absolute; bottom: 16px; right: 16px; width: 44px; height: 44px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 25%, transparent); color: var(--accent); z-index: 90; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); box-shadow: 0 10px 26px rgb(15 23 42 / .18); }
    .special-keys-icon:hover, .special-keys-icon:focus-visible { background: color-mix(in srgb, var(--accent) 34%, transparent); color: var(--accent-dark); outline: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), 0 10px 26px rgb(15 23 42 / .18); }
    .special-keys-panel { position: absolute; bottom: 16px; right: 16px; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 18px 40px rgb(15 23 42 / .12); z-index: 90; display: flex; flex-direction: row; align-items: center; gap: 8px; }
    .special-keys-bar { position: relative; z-index: 90; flex: 0 0 auto; width: 100%; padding: 8px 12px env(safe-area-inset-bottom) 12px; background: var(--surface); border-top: 1px solid var(--border); display: none; }
    .special-keys-collapse-col { display: flex; align-items: center; justify-content: center; }
    .special-keys-grid { display: grid; grid-template-columns: repeat(6, 1fr); grid-auto-rows: auto; gap: 6px; }
    .special-keys-grid > .special-keys-key { width: 100%; min-width: 0; }
    .special-keys-key { min-width: var(--control-h); height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 8px; background: var(--surface-soft); color: var(--text); font: inherit; font-size: var(--control-fs); font-weight: 800; }
    .special-keys-key.is-armed { border-color: var(--accent-red, #d33); color: var(--accent-red, #d33); background: color-mix(in srgb, var(--accent-red, #d33) 12%, var(--surface-soft)); }
    .special-keys-key:hover, .special-keys-key:focus-visible { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); outline: 0; }
    .special-keys-key.is-armed:hover, .special-keys-key.is-armed:focus-visible { border-color: var(--accent-red, #d33); color: var(--accent-red, #d33); background: color-mix(in srgb, var(--accent-red, #d33) 18%, var(--surface-soft)); }
    @media (max-width: 760px), (pointer: coarse) { .special-keys-key { min-width: 44px; height: 44px; } .special-keys-icon { width: 44px; height: 44px; } .special-keys-panel { display: none; } .special-keys-bar { display: flex; flex-direction: row; align-items: center; gap: 8px; } .special-keys-bar .special-keys-grid { grid-template-columns: repeat(6, minmax(44px, 1fr)); width: 100%; } }
    @media (max-width: 380px) { .special-keys-bar .special-keys-grid { grid-template-columns: repeat(3, 1fr); } }

    .agent-list { isolation: isolate; }
    .brand-toggle { width: auto; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .brand-toggle:hover .brand-title { color: var(--accent-dark); }
    .brand-logo { width: 28px; height: 28px; padding: 0; border-radius: 22.5%; background: transparent; overflow: hidden; box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 28%, transparent); }
    .brand-logo img { display: block; width: 100%; height: 100%; }
    .mobile-sidebar-backdrop { display: none; }
    .workspace-switcher { position: relative; margin: 8px 8px 10px; }
    .workspace-switcher-trigger { width: 100%; min-height: 42px; display: grid; grid-template-columns: 28px minmax(0, 1fr) 14px; align-items: center; gap: 9px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); text-align: left; }
    .workspace-switcher-trigger:hover, .workspace-switcher-trigger:focus-visible { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); outline: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent); }
    .workspace-avatar { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: var(--accent-light); color: var(--accent-dark); font-family: var(--font-mono); font-size: 10px; font-weight: 900; letter-spacing: 0; }
    .workspace-switcher-copy, .workspace-menu-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .workspace-name, .workspace-menu-copy strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-strong); font-size: 13px; font-weight: 800; }
    .workspace-type-tag, .workspace-menu-copy small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; line-height: 1.2; }
    .workspace-caret { color: var(--muted); font-size: 11px; text-align: center; }
    .workspace-menu { position: absolute; z-index: 180; left: 0; right: 0; top: calc(100% + 6px); max-height: min(360px, 68vh); overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 18px 40px rgb(15 23 42 / .18); }
    .workspace-menu.hidden { display: none; }
    .workspace-menu-row { width: 100%; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 9px; padding: 8px; border: 0; border-radius: 7px; background: transparent; color: var(--text); text-align: left; }
    .workspace-menu-row:hover, .workspace-menu-row:focus-visible, .workspace-menu-row.active { background: var(--accent-light); color: var(--accent-dark); outline: 0; }
    .workspace-menu-footer { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding: 8px 6px 2px; border-top: 1px solid var(--border-soft); }
    .workspace-menu-add { width: 100%; padding: 8px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--field); color: var(--text-strong); font-size: 12px; font-weight: 800; text-align: center; }
    .workspace-menu-add:hover, .workspace-menu-add:focus-visible { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); outline: 0; }
    .workspace-current-path { display: block; min-width: 0; overflow-wrap: anywhere; white-space: normal; color: var(--muted); font-family: var(--font-mono); font-size: 10px; }
    .workspace-menu-empty { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--font-mono); font-size: 10px; }
    .workspace-menu-empty { padding: 9px 8px; font-family: inherit; font-size: 12px; }
    .workspace-add-modal .field-input { width: 100%; min-height: var(--control-h); margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); padding: 0 var(--control-px); font: inherit; font-size: var(--control-fs); outline: 0; }
    .workspace-add-modal .field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
    .workspace-add-status { min-height: 18px; margin-top: 2px; color: var(--muted); font-size: 12px; }
    .workspace-add-status.error { color: var(--red); }
    .workspace-menu-rbac { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
    .rbac-mode-picker { display: flex; gap: 8px; margin-bottom: 8px; }
    .rbac-mode-option { flex: 1; padding: 8px 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--field); color: var(--text); font: inherit; font-weight: 700; cursor: pointer; transition: background .12s, border-color .12s; }
    .rbac-mode-option:hover, .rbac-mode-option:focus-visible { border-color: var(--accent); outline: 0; }
    .rbac-mode-option.selected { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .rbac-mode-help { margin: 0 0 12px 0; padding: 0 0 0 18px; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .rbac-mode-help li { margin-bottom: 2px; }
    .rbac-mode-help strong { color: var(--text-strong); font-weight: 700; }
    .workspaces-overview-page { display: flex; flex-direction: column; width: 100%; min-width: 0; height: 100%; min-height: 0; }
    .workspace-overview-error { margin-bottom: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--red) 38%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--red) 8%, var(--surface)); color: var(--red); font-size: 13px; }
    .agent-overview-warning { margin: 0 0 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--amber) 42%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--amber) 10%, var(--surface)); color: var(--text-strong); font-size: 13px; line-height: 1.45; }
    .agent-overview-warning strong { color: var(--amber); }
    :root[data-sidebar="collapsed"] .workspace-switcher { margin: 8px; }
    :root[data-sidebar="collapsed"] .workspace-switcher-trigger { grid-template-columns: 28px; justify-content: center; padding: 7px; }
    :root[data-sidebar="collapsed"] .workspace-switcher-copy, :root[data-sidebar="collapsed"] .workspace-caret { display: none; }
    :root[data-sidebar="collapsed"] .workspace-menu { left: calc(100% + 8px); right: auto; top: 0; width: 230px; }
    .sidebar-actions { display: flex; flex-direction: column; gap: 6px; padding: 10px 8px; border-top: 1px solid var(--border-soft); }
    .sidebar-action { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 9px 12px; border-radius: 8px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 700; text-align: left; transition: background .1s, color .1s, box-shadow .1s; }
    .sidebar-action:hover { background: var(--surface-hover); color: var(--text-strong); }
    .sidebar-action.primary { background: var(--accent); color: #fff; box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 28%, transparent); }
    .sidebar-action.primary:hover { background: var(--accent-dark); color: #fff; }
    .sidebar-action:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; }
    .sidebar-action.hidden { display: none; }
    .sidebar-action svg { flex: 0 0 auto; }
    .nav a { position: relative; width: 100%; display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 9px 12px; border-radius: 10px; border: 0; background: transparent; color: var(--muted); font-size: 13px; font-weight: 800; text-align: left; text-decoration: none; transition: background .1s, color .1s; }
    .nav a:hover { background: var(--surface-hover); color: var(--text-strong); }
    .nav a.active { background: var(--accent-light); color: var(--accent-dark); }
    .nav a:focus-visible { outline: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .nav a svg { flex: 0 0 auto; }
    :root[data-sidebar="collapsed"] .nav a { justify-content: center; gap: 0; padding: 9px 0; }
    .notification-icon-muted { display: none; }
    #notificationBtn[data-notification-state="off"] .notification-icon-on { display: none; }
    #notificationBtn[data-notification-state="off"] .notification-icon-muted { display: block; }
    .sidebar-action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :root[data-sidebar="collapsed"] .sidebar-actions { padding: 10px 8px; }
    :root[data-sidebar="collapsed"] .sidebar-action { justify-content: center; gap: 0; padding: 9px 0; }
    :root[data-sidebar="collapsed"] .sidebar-action-label { display: none; }
    .peer-icon.codex { background: oklch(94% 0.06 80); color: oklch(42% 0.14 70); }
    .peer-icon.pi { background: oklch(95% 0.05 200); color: oklch(38% 0.13 200); }
    .agent-tab-dot.offline { background: #9ca3af; }
    .agent-tab-dot.nudge-blocked { background: var(--amber); animation: attentionBlink .8s steps(2, end) infinite; }
    .role-card { position: relative; overflow: visible; }
    .role-card:has(.launch-menu) { z-index: 80; }
    .role-card .role-row { align-items: flex-start; }
    .role-card .role-main { display: flex; flex-direction: column; gap: 4px; }
    .role-line-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
    .role-card .role-name { min-width: 0; }
    .role-card .role-name span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .role-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--muted); font-size: 11px; line-height: 1.35; }
    .role-rbac-chips { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .role-roles-empty { color: var(--muted); }
    .role-card .role-summary { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; }
    .role-card .role-actions { margin-left: auto; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 760px) { .role-line-top { align-items: flex-start; } .role-card .role-actions { max-width: 58%; } }
    .launch-split { z-index: 1; }
    .launch-split:has(.launch-menu) { z-index: 90; }
    .launch-menu { z-index: 100; }

    .btn:not(.danger):not(:disabled):focus-visible, .sidebar-action:not(:disabled):focus-visible, .launch-arrow:not(:disabled):focus-visible, .launch-menu button:not(:disabled):focus-visible, .settings-dropdown-trigger:not(:disabled):focus-visible, .seg-option:not(:disabled):focus-visible, .choice:not(:disabled):focus-visible, .role-pick:not(:disabled):focus-visible, .policy-card:not(:disabled):focus-visible, .runtime-default-choice:not(:disabled):focus-visible, .agent-sort-trigger:not(:disabled):focus-visible { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .btn:not(.danger):not(:disabled):hover, .launch-arrow:not(:disabled):hover, .launch-menu button:not(:disabled):hover, .settings-dropdown-trigger:not(:disabled):hover, .seg-option:not(:disabled):hover, .choice:not(:disabled):hover, .role-pick:not(:disabled):hover, .policy-card:not(:disabled):hover, .runtime-default-choice:not(:disabled):hover, .agent-sort-trigger:not(:disabled):hover { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent); }
    .btn:not(.danger):not(:disabled):not(.secondary):hover, .message-composer-send-icon:not(:disabled):hover, .sidebar-action.primary:not(:disabled):hover { background: color-mix(in srgb, var(--accent) 82%, var(--text) 18%); color: #fff; }
    .btn.secondary:not(.danger):not(:disabled):hover, .sidebar-action:not(.primary):not(:disabled):hover, .launch-arrow:not(:disabled):hover, .launch-menu button:not(:disabled):not(.active):hover, .settings-dropdown-trigger:not(:disabled):hover, .seg-option:not(.active):not(:disabled):hover, .choice:not(.active):not(:disabled):hover, .role-pick:not(.active):not(:disabled):hover, .policy-card:not(.active):not(:disabled):hover, .runtime-default-choice:not(.active):not(:disabled):hover, .agent-sort-trigger:not(:disabled):hover { background: var(--accent-light); color: var(--accent-dark); }

    .term-tab.active:not(.terminal-active) { background: var(--accent-light); color: var(--accent-dark); border-bottom-color: var(--accent); box-shadow: inset 0 -3px 0 var(--accent), inset 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent); font-weight: 800; }
    .term-tab.active:not(.terminal-active) .badge { background: var(--surface); border-color: var(--accent); color: var(--accent-dark); }
    /* EP-002 WA-008: 2-line tab label so multi-repo workspaces with same bare role name (e.g. repoA:main + repoB:main) stay visually distinct. */
    .term-tab .term-tab-label { display: flex; flex-direction: column; align-items: flex-start; gap: 0; line-height: 1.15; min-width: 0; }
    .term-tab .term-tab-label-repo { color: var(--muted); font-size: 10.5px; font-weight: 600; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .term-tab.active:not(.terminal-active) .term-tab-label-repo { color: color-mix(in srgb, var(--accent-dark) 80%, transparent); }
    .term-tab.terminal-active .term-tab-label-repo { color: color-mix(in srgb, #d4d4d4 60%, transparent); }
    .term-tab .term-tab-label-name { font-size: 12.5px; font-weight: inherit; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .agent-page .tabbar, .messages-page .tabbar, .settings-page .tabbar, .workspaces-overview-page .tabbar, .kanban-page .kanban-tabbar { border-radius: 0; border-left: 0; border-right: 0; }
    .agent-page .tabbar { display: flex; flex: 0 0 auto; min-width: 0; overflow: hidden; }
    .mobile-sidebar-tab { display: none; }
    .agent-page .agent-overview-tab { flex: 0 0 auto; border-right: 1px solid var(--border); }
    .agent-page .tabbar-scroll { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; display: flex; scrollbar-width: thin; }
    .agent-page .tabbar-scroll .term-tab { flex: 0 0 auto; }
    .kanban-page-epics { display: flex; flex-direction: column; }
    .kanban-page-archive .kanban-main { min-height: 0; }
    .archive-summary { display: flex; align-items: center; gap: 6px; margin-left: auto; color: var(--muted); font-size: 12px; font-weight: 750; }
    .archive-summary strong { color: var(--text-strong); font-family: var(--font-mono); font-size: 11px; }
    .archive-board { --kanban-agent-width: 170px; flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--surface); }
    .archive-head, .archive-row { display: grid; grid-template-columns: var(--kanban-agent-width) minmax(860px, 1fr); min-width: calc(var(--kanban-agent-width) + 860px); }
    .archive-head { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 96%, transparent); backdrop-filter: blur(10px); }
    .archive-agent-head { position: sticky; left: 0; z-index: 12; padding: 10px 0 10px 14px; border-right: 1px solid var(--border); background: inherit; color: var(--muted); font-size: 11px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
    .archive-table-head, .archive-item { display: grid; grid-template-columns: 90px minmax(260px, 1.25fr) 104px 104px 96px 132px 142px 78px; align-items: center; }
    .archive-table-head { min-height: 38px; color: var(--muted); font-size: 10.5px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
    .archive-table-head span { padding: 0 10px; border-right: 1px solid var(--border-soft); }
    .archive-row { min-height: 74px; border-bottom: 1px solid var(--border-soft); }
    .archive-lane-head { position: sticky; left: 0; z-index: 8; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; padding: 12px 14px; border-right: 1px solid var(--border); background: var(--surface); text-align: left; }
    .archive-lane-head .lane-agent { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .archive-lane-head .lane-label { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
    .archive-lane-head .lane-repo { color: var(--muted); font-size: 10px; font-weight: 650; max-width: 138px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .archive-lane-head .lane-name { color: var(--text-strong); font-size: 12.5px; font-weight: 850; max-width: 138px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .archive-lane-head .lane-count { color: var(--muted); font-size: 10px; }
    .archive-progress { width: 132px; height: 3px; overflow: hidden; border-radius: 999px; background: var(--border-soft); }
    .archive-progress span { display: block; height: 100%; border-radius: inherit; background: var(--green); }
    .archive-table { display: flex; flex-direction: column; min-width: 0; }
    .archive-item { width: 100%; min-height: 52px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 84%, transparent); border-radius: 0; background: color-mix(in srgb, var(--surface-soft) 44%, var(--surface)); color: var(--text); text-align: left; cursor: pointer; }
    .archive-item:hover, .archive-item.selected { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
    .archive-item.selected { box-shadow: inset 3px 0 0 var(--accent); }
    .archive-item:last-child { border-bottom: 0; }
    .archive-item > * { min-width: 0; padding: 7px 10px; }
    .archive-id { color: var(--accent-dark); font: 800 11px var(--font-mono); }
    .archive-title { display: flex; flex-direction: column; gap: 3px; }
    .archive-title strong { overflow: hidden; color: var(--text-strong); font-size: 12.5px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
    .archive-title span, .archive-muted { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .archive-date { color: var(--text); font: 600 11px var(--font-mono); }
    .archive-detail-link { color: var(--accent-dark); font-size: 11px; font-weight: 850; }
    .archive-empty-line { padding: 16px 12px; color: var(--muted); font-size: 12px; }
    @media (max-width: 760px) { .archive-board { --kanban-agent-width: 136px; } .archive-head, .archive-row { grid-template-columns: var(--kanban-agent-width) minmax(820px, 1fr); min-width: calc(var(--kanban-agent-width) + 820px); } .archive-lane-head { padding: 10px; } .archive-summary { width: 100%; margin-left: 0; } }
    .kanban-page-epics .kanban-epics-view { flex: 1 1 auto; min-width: 0; min-height: 0; padding: 12px 16px; overflow: auto; }
    .kanban-page-epics.detail-open { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 29vw); grid-template-rows: auto 1fr; }
    .kanban-page-epics.detail-open .kanban-tabbar { grid-column: 1 / -1; }
    .kanban-page-epics.detail-open .kanban-detail { grid-column: 2; grid-row: 2; }
    /* EP-003 WA-014: epic-drawer-open mirrors detail-open layout so an epic detail view shrinks the board area instead of overlaying it. */
    .kanban-page-epics.kanban-epic-drawer-open { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 29vw); grid-template-rows: auto 1fr; }
    .kanban-page-epics.kanban-epic-drawer-open .kanban-tabbar { grid-column: 1 / -1; }
    .kanban-page-epics.kanban-epic-drawer-open .kanban-epics-view { grid-column: 1; grid-row: 2; }
    .kanban-page-epics.kanban-epic-drawer-open .kanban-epic-drawer { grid-column: 2; grid-row: 2; }
    .kanban-epics-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .kanban-epics-toolbar .kanban-epics-status-filter { display: flex; align-items: center; gap: 6px; }
    .kanban-epics-toolbar .kanban-epics-vis-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text); }
    .kanban-epics-toolbar .kanban-epics-vis-notice { font-size: 12px; color: color-mix(in srgb, var(--text) 60%, transparent); }
    .kanban-epic-list { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .kanban-epic-section { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); overflow: hidden; }
    .kanban-epic-header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; user-select: none; }
    .kanban-epic-header:hover { background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }
    .kanban-epic-caret { font-size: 14px; width: 14px; display: inline-block; }
    .kanban-epic-id { font-family: var(--font-mono, monospace); font-size: 12px; color: color-mix(in srgb, var(--text) 70%, transparent); }
    .kanban-epic-title { font-weight: 700; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-epic-child-count { font-size: 12px; color: color-mix(in srgb, var(--text) 60%, transparent); padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); }
    .kanban-epic-close-pill { width: max-content; background: #f6a623; color: #1a1300; border: 1px solid #d18a13; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .kanban-epic-details-btn { margin-left: auto; }
    .kanban-epic-body { padding: 8px 12px 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; overflow-x: auto; min-width: 0; }
    .kanban-epic-body .kanban-board-epic { overflow: auto; min-height: 0; }
    .kanban-epic-issue { display: flex; align-items: stretch; gap: 10px; padding: 10px 11px; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; background: var(--surface); color: var(--text); text-align: left; cursor: pointer; box-shadow: 0 10px 18px rgb(15 23 42 / .06); transition: box-shadow .12s, transform .12s, border-color .12s; }
    .kanban-epic-issue:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); border-left-color: var(--accent-dark); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent), 0 12px 24px rgb(15 23 42 / .08); }
    .kanban-epic-issue.priority-p0 { border-left-color: var(--red); }
    .kanban-epic-issue.priority-p1 { border-left-color: var(--amber); }
    .kanban-epic-issue.priority-p2 { border-left-color: var(--yellow); }
    .kanban-epic-issue.priority-p3 { border-left-color: var(--green); }
    .kanban-epic-dag-node.priority-p0 .kanban-epic-dag-card { border-left: 3px solid var(--red); }
    .kanban-epic-dag-node.priority-p1 .kanban-epic-dag-card { border-left: 3px solid var(--amber); }
    .kanban-epic-dag-node.priority-p2 .kanban-epic-dag-card { border-left: 3px solid var(--yellow); }
    .kanban-epic-dag-node.priority-p3 .kanban-epic-dag-card { border-left: 3px solid var(--green); }
    /* EP-003 WA-011: this used to be an initials chip; now wraps an identiconFor() SVG. Kept .kanban-epic-issue-avatar selector for both DAG node + epic drawer head; size driven by inline width/height so callers can tune. */
    .kanban-epic-issue-avatar { flex: 0 0 auto; border-radius: 6px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-soft); background: var(--surface); }
    .kanban-epic-issue-avatar > svg { display: block; width: 100%; height: 100%; }
    .kanban-epic-issue-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .kanban-epic-issue-title { display: flex; align-items: center; gap: 8px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-epic-issue-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: color-mix(in srgb, var(--text) 70%, transparent); }
    .kanban-epic-issue-card { width: 100%; margin-bottom: 0; }
    .kanban-card-assignee { color: var(--muted); font-size: 11px; font-weight: 600; margin-left: auto; padding-right: 6px; }
    @media (max-width: 760px) { .kanban-epics-toolbar .kanban-epics-vis-toggle input[disabled] { opacity: 0.5; cursor: not-allowed; } }

    /* EP-003 WA-014: epic detail used to be a fixed overlay + dim backdrop. Now it sits in the page grid alongside .kanban-detail (parity with task detail). Backdrop element + rule removed; .kanban-epic-drawer is rendered as an in-grid aside. */
    .kanban-epic-drawer { min-width: 0; min-height: 0; overflow-y: auto; background: var(--surface); border-left: 1px solid var(--border); box-shadow: -18px 0 34px rgb(15 23 42 / .08); padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
    .kanban-epic-drawer-head { display: flex; align-items: flex-start; gap: 10px; margin: -16px -18px 0; padding: 16px 18px 8px; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; background: var(--surface); }
    .kanban-epic-drawer-head > div { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .kanban-epic-drawer-head h2 { margin: 0; font-size: 18px; font-weight: 700; }
    .kanban-epic-drawer-id { font-family: var(--font-mono, monospace); font-size: 12px; color: color-mix(in srgb, var(--text) 70%, transparent); }
    .kanban-epic-drawer-meta { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
    .kanban-epic-drawer-meta-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .kanban-epic-drawer-pills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .kanban-epic-drawer-section { display: flex; flex-direction: column; gap: 6px; }
    .kanban-epic-drawer-section h3 { margin: 4px 0 2px; font-size: 13px; font-weight: 700; color: color-mix(in srgb, var(--text) 80%, transparent); text-transform: uppercase; letter-spacing: 0.04em; }
    .kanban-epic-drawer-close-banner { background: #fff7e6; border: 1px solid #f0b260; border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #5b3b00; display: flex; flex-direction: column; gap: 8px; }
    .kanban-epic-drawer-close-banner-children { font-size: 12px; color: color-mix(in srgb, #5b3b00 80%, transparent); }
    .kanban-epic-drawer-close-banner-children a { color: var(--accent-dark); cursor: pointer; }
    .kanban-epic-drawer-close-banner-actions { display: flex; gap: 8px; }
    .kanban-epic-drawer-approve { background: #2c7a2c; border-color: #1f5e1f; color: #fff; }
    .kanban-epic-drawer-approve:hover { background: #1f5e1f; }
    .kanban-epic-drawer-cancel-close { }
    @media (max-width: 960px) { .kanban-page-epics.kanban-epic-drawer-open { display: flex; } .kanban-epic-drawer { width: 100%; border-left: 0; border-top: 1px solid var(--border); box-shadow: 0 -18px 34px rgb(15 23 42 / .18); max-height: 78%; } }

    .kanban-epic-cycle-warning { background: #fff7e6; border: 1px solid #f0b260; border-radius: 8px; padding: 8px 12px; font-size: 12px; color: #5b3b00; margin-bottom: 8px; }
    .kanban-epic-dag { position: relative; overflow: auto; padding: 8px 4px; }
    .kanban-epic-dag-edges { position: absolute; left: 0; top: 0; pointer-events: none; }
    .kanban-epic-dag-edge { fill: none; stroke: color-mix(in srgb, var(--text) 50%, transparent); stroke-width: 1.5; }
    .kanban-epic-dag-node { position: absolute; box-sizing: border-box; }
    /* EP-003 WA-013: DAG node now consumes the shared kanban-card markup. Override base .kanban-card row/col tweaks for the in-graph context. */
    .kanban-epic-dag-card.kanban-card { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 10px 12px 22px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); cursor: pointer; text-align: left; box-shadow: none; margin-bottom: 0; }
    .kanban-epic-dag-card.kanban-card:hover { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
    /* EP-003 WA-013: per advisor msg #34, shared content contract — repo:role line above title, kanban-id pinned to bottom-right of card. */
    .kanban-card-repo-line { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--font-mono); font-size: 10px; font-weight: 600; }
    .kanban-card-dag { position: relative; }
    .kanban-card-dag .kanban-card-meta { padding-right: 56px; }
    .kanban-card-dag .kanban-id { position: absolute; right: 10px; bottom: 6px; margin-left: 0; }
    .kanban-epic-dag-external { position: absolute; right: -10px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 50%; background: var(--surface); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border)); color: var(--accent-dark); font-size: 14px; line-height: 1; cursor: help; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .kanban-epic-dag-external.inward { right: auto; left: -10px; }
    .kanban-epic-dag-external.inward + .kanban-epic-dag-external-popup { right: auto; left: -10px; transform: translate(-40%, 0); }
    .kanban-epic-dag-external.inward[data-popup-side="above"] + .kanban-epic-dag-external-popup { transform: translate(-40%, 0); }
    .kanban-epic-dag-external-popup { position: absolute; right: -10px; top: calc(50% + 11px); transform: translate(40%, 0); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 6px 18px color-mix(in srgb, #000 18%, transparent); display: none; z-index: 100; min-width: 180px; }
    /* WA-055: invisible bridge across the small vertical gap between
       trigger and popup keeps the popup hoverable while the cursor moves
       down from the trigger. Width spans full popup so any cursor path
       hits it. */
    .kanban-epic-dag-external-popup::before { content: ''; position: absolute; left: 0; right: 0; top: -10px; height: 12px; }
    .kanban-epic-dag-external:hover + .kanban-epic-dag-external-popup, .kanban-epic-dag-external-popup:hover { display: block; }
    /* WA-055: above-variant for triggers near the bottom edge. JS may flip
       the popup by setting data-popup-side="above" on the trigger; until
       then this rule lets future logic do it without another CSS change. */
    .kanban-epic-dag-external[data-popup-side="above"] + .kanban-epic-dag-external-popup { top: auto; bottom: calc(50% + 11px); }
    .kanban-epic-dag-external[data-popup-side="above"] + .kanban-epic-dag-external-popup::before { top: auto; bottom: -10px; }
    .kanban-epic-dag-popup-group { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
    .kanban-epic-dag-popup-group:first-child { border-top: 0; }
    .kanban-epic-dag-popup-group strong { font-weight: 700; font-size: 11px; text-transform: uppercase; color: color-mix(in srgb, var(--text) 70%, transparent); }
    .kanban-epic-dag-popup-group a { color: var(--accent-dark); cursor: pointer; }
    .agent-page .tab-content, .messages-page .inbox-panel, .settings-panel, .workspaces-overview-page .tab-content { border-radius: 0; border-left: 0; border-right: 0; border-bottom: 0; }
    .agent-page .card, .messages-page .card, .settings-page .card { border-radius: 0; box-shadow: none; }
    .agent-page .card-pad, .settings-page .card-pad { padding: 14px 16px; }
    .settings-panel { padding: 0; }
    .settings-grid { gap: 0; }
    .settings-with-subnav { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 0; }
    .settings-subnav.tabbar { flex: 0 0 auto; min-height: 0; overflow: hidden; padding: 0; border-right: 0; background: var(--surface); }
    .settings-subnav .tabbar-scroll { flex: 1 1 auto; min-width: 0; overflow-x: auto; display: flex; }
    .settings-subnav-item.term-tab { flex: 0 0 auto; width: auto; display: inline-flex; align-items: center; flex-direction: row; gap: 6px; padding: 0 14px; border-radius: 0; text-align: left; }
    .settings-subnav-item + .settings-subnav-item { margin-top: 0; }
    .settings-subnav-item span { font-size: 13px; font-weight: 800; }
    .settings-with-subnav .settings-panel { min-width: 0; min-height: 0; overflow: auto; }
    .settings-with-subnav .settings-grid { display: flex; flex-direction: column; min-height: 100%; }
    .settings-with-subnav .settings-wide { grid-column: auto; }
    .settings-with-subnav .section-head { margin-bottom: 12px; padding-bottom: 12px; }
    .settings-with-subnav .section-head h2 { display: inline-flex; align-items: center; margin-right: 8px; }
    .settings-scope-badge { display: inline-flex; align-items: center; width: fit-content; vertical-align: 2px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-soft); color: var(--accent-dark); font-size: 10px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
    .settings-with-subnav .card { flex: 0 0 auto; border: 0; border-bottom: 1px solid var(--border); background: var(--surface); }
    .settings-with-subnav .card-pad { padding: 18px 20px; }
    .settings-with-subnav .setting-row { display: grid; grid-template-columns: minmax(210px, .42fr) minmax(260px, .58fr); gap: 4px 20px; align-items: center; padding: 14px 0; }
    .settings-with-subnav .setting-row > .setting-title { grid-column: 1; }
    .settings-with-subnav .setting-row > .setting-sub { grid-column: 1; margin: 2px 0 0; }
    .settings-with-subnav .setting-row > :last-child { grid-column: 2; grid-row: 1 / span 2; align-self: center; justify-self: start; }
    .settings-with-subnav .segmented, .settings-with-subnav .policy-card-grid, .settings-with-subnav .runtime-default-grid { gap: 7px; }
    .settings-with-subnav .seg-option { display: inline-flex; align-items: center; gap: 6px; }
    .settings-with-subnav .seg-option, .settings-with-subnav .runtime-default-choice, .settings-with-subnav .role-pick { border-radius: 999px; }
    .settings-with-subnav .setting-select, .settings-with-subnav .settings-dropdown-trigger, .settings-with-subnav .policy-card, .settings-with-subnav .command-preview, .settings-with-subnav .runner-diag { border-radius: 9px; }
    .settings-dropdown { position: relative; min-width: 170px; max-width: 100%; }
    .settings-dropdown .settings-dropdown-trigger { min-width: 0; min-height: var(--control-h); width: 100%; justify-content: flex-start; border-top-right-radius: 0; border-bottom-right-radius: 0; padding: 0 var(--control-px); font-size: var(--control-fs); }
    .settings-dropdown .launch-arrow { border-top-left-radius: 0; border-bottom-left-radius: 0; }
    .settings-dropdown-label { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .settings-dropdown .launch-menu { display: none; left: 0; right: auto; min-width: 100%; max-height: min(280px, 48vh); overflow: auto; }
    .settings-dropdown.open .launch-menu { display: block; }
    .settings-dropdown .launch-menu button.active { background: var(--accent-light); color: var(--accent-dark); font-weight: 800; }
    .choice.active, .role-pick.active { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .broadcast-modal textarea { width: 100%; min-height: 180px; resize: vertical; border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); padding: 10px 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.45; outline: 0; }
    .broadcast-modal textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .broadcast-status { min-height: 18px; margin-top: 10px; color: var(--muted); font-size: 12px; }
    .broadcast-status.error { color: var(--red); }
    .chat-history-retention { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .chat-history-custom { width: 140px; min-height: var(--control-h); border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); padding: 0 var(--control-px); font: inherit; font-size: var(--control-fs); }
    .chat-history-clear { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; }
    .chat-history-confirm-input { max-width: 180px; min-width: 130px; min-height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); font: inherit; font-size: var(--control-fs); }
    .message-settings-limit { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .message-settings-limit input { width: 150px; }
    .user-account-name { color: var(--text-strong); font-weight: 800; }
    .auth-recovery-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .auth-recovery-result:empty { display: none; }
    .auth-password-modal { width: min(440px, 100%); }
    .auth-password-modal .field-input { width: 100%; min-height: var(--control-h); margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); padding: 0 var(--control-px); font: inherit; font-size: var(--control-fs); outline: 0; }
    .auth-password-modal .field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
    .auth-sessions-row > .auth-sessions-panel { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
    .auth-session-list { width: 100%; }
    .peer-rule-row.auth-session-row { width: 100%; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
    .auth-session-meta { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .auth-session-agent { color: var(--text-strong); font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .auth-session-last-seen { color: var(--muted); font-size: 12px; }
    .about-card { padding: 0; overflow: hidden; }
    .about-hero { position: relative; min-height: 340px; display: flex; align-items: center; overflow: hidden; border-bottom: 1px solid var(--border); background: var(--surface-soft); }
    [data-theme="dark"] .about-hero { background: #080e18; }
    @media (prefers-color-scheme: dark) { :root[data-theme="auto"] .about-hero { background: #080e18; } }
    .about-network { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
    .about-network-edge { stroke: oklch(60% 0.18 240 / 0.22); stroke-width: 1.5; }
    .about-network-dot { fill: oklch(60% 0.18 240 / 0.38); }
    [data-theme="dark"] .about-network-edge { stroke: oklch(70% 0.07 250 / 0.08); stroke-width: 1; }
    [data-theme="dark"] .about-network-dot { fill: oklch(70% 0.07 250 / 0.16); }
    @media (prefers-color-scheme: dark) {
      :root[data-theme="auto"] .about-network-edge { stroke: oklch(70% 0.07 250 / 0.08); stroke-width: 1; }
      :root[data-theme="auto"] .about-network-dot { fill: oklch(70% 0.07 250 / 0.16); }
    }
    .about-hero-overlays {
      position: absolute; inset: 0; z-index: 2; pointer-events: none;
      background:
        radial-gradient(ellipse at 50% 50%, var(--surface-soft) 10%, color-mix(in srgb, var(--surface-soft) 55%, transparent) 50%, transparent 80%),
        radial-gradient(ellipse at 85% 30%, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 65%),
        radial-gradient(ellipse at 15% 50%, color-mix(in srgb, var(--accent) 28%, transparent) 0%, transparent 65%);
    }
    [data-theme="dark"] .about-hero-overlays {
      background:
        radial-gradient(ellipse at 50% 50%, color-mix(in srgb, #080e18 92%, transparent) 20%, color-mix(in srgb, #080e18 60%, transparent) 55%, transparent 80%),
        radial-gradient(ellipse at 85% 30%, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 65%),
        radial-gradient(ellipse at 15% 50%, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 65%);
    }
    @media (prefers-color-scheme: dark) {
      :root[data-theme="auto"] .about-hero-overlays {
        background:
          radial-gradient(ellipse at 50% 50%, color-mix(in srgb, #080e18 92%, transparent) 20%, color-mix(in srgb, #080e18 60%, transparent) 55%, transparent 80%),
          radial-gradient(ellipse at 85% 30%, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 65%),
          radial-gradient(ellipse at 15% 50%, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 65%);
      }
    }
    .about-hero-content { position: relative; z-index: 3; display: flex; align-items: center; gap: 52px; padding: 52px 60px; width: 100%; }
    .about-hero-icon-large { flex-shrink: 0; }
    .about-app-icon { display: block; border-radius: 36px; filter: drop-shadow(0 8px 24px color-mix(in srgb, var(--accent) 30%, transparent)); }
    [data-theme="dark"] .about-app-icon { filter: drop-shadow(0 12px 28px color-mix(in srgb, var(--accent) 50%, transparent)); }
    @media (prefers-color-scheme: dark) { :root[data-theme="auto"] .about-app-icon { filter: drop-shadow(0 12px 28px color-mix(in srgb, var(--accent) 50%, transparent)); } }
    .about-hero-text { flex: 1; min-width: 0; }
    .about-wordmark {
      display: inline-block;
      font-family: 'Epilogue', 'Plus Jakarta Sans', sans-serif;
      font-weight: 800; font-size: 44px; line-height: 1; letter-spacing: -0.03em;
      margin-bottom: 10px;
      background-image: linear-gradient(135deg, var(--text-strong) 0%, var(--accent) 60%, var(--accent-dark) 100%);
      background-clip: text; -webkit-background-clip: text;
      color: transparent; -webkit-text-fill-color: transparent;
    }
    [data-theme="dark"] .about-wordmark { background-image: linear-gradient(135deg, #f0f6ff 30%, var(--accent) 100%); }
    @media (prefers-color-scheme: dark) { :root[data-theme="auto"] .about-wordmark { background-image: linear-gradient(135deg, #f0f6ff 30%, var(--accent) 100%); } }
    .about-tagline { font-family: 'Space Grotesk', 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; line-height: 1.7; color: var(--muted); max-width: 420px; margin: 0 0 28px; }
    .about-github-link { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 9px; background: color-mix(in srgb, var(--accent) 8%, transparent); border: 1.5px solid color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); font-size: 13px; font-weight: 700; text-decoration: none; transition: background .15s, border-color .15s; backdrop-filter: blur(4px); }
    .about-github-link:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: color-mix(in srgb, var(--accent) 36%, transparent); text-decoration: none; }
    [data-theme="dark"] .about-github-link { background: color-mix(in srgb, var(--accent) 15%, transparent); border-color: color-mix(in srgb, var(--accent) 28%, transparent); color: color-mix(in srgb, var(--accent) 70%, white 30%); }
    [data-theme="dark"] .about-github-link:hover { background: color-mix(in srgb, var(--accent) 24%, transparent); }
    @media (prefers-color-scheme: dark) {
      :root[data-theme="auto"] .about-github-link { background: color-mix(in srgb, var(--accent) 15%, transparent); border-color: color-mix(in srgb, var(--accent) 28%, transparent); color: color-mix(in srgb, var(--accent) 70%, white 30%); }
      :root[data-theme="auto"] .about-github-link:hover { background: color-mix(in srgb, var(--accent) 24%, transparent); }
    }
    .about-info { padding: 28px 32px; display: flex; flex-direction: column; }
    .about-info-row { display: flex; align-items: center; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--border-soft); }
    .about-info-row:last-child { border-bottom: 0; }
    .about-info-label { width: 140px; flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .about-info-value { font-size: 13px; font-weight: 600; color: var(--text-strong); }
    .about-info-value.mono { font-family: var(--font-mono); }
    .about-legal { margin: 0 32px 32px; padding: 16px 20px; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--border-soft); font-size: 11.5px; color: var(--muted); line-height: 1.65; font-family: var(--font-mono); }
    @media (max-width: 720px) {
      .about-hero { min-height: 280px; }
      .about-hero-content { flex-direction: column; align-items: flex-start; gap: 24px; padding: 36px 28px; }
      .about-app-icon { width: 120px; height: 120px; }
      .about-wordmark { font-size: 36px; }
      .about-info, .about-legal { padding-left: 20px; padding-right: 20px; margin-left: 16px; margin-right: 16px; }
    }
    .message-length-counter { align-self: flex-end; flex: 0 0 auto; color: var(--muted); font-family: var(--font-mono); font-size: 11px; white-space: nowrap; }
    .message-length-counter.over-limit { color: var(--red); font-weight: 800; }
    .broadcast-modal .message-length-counter { align-self: auto; margin-top: 6px; }
    .settings-with-subnav .agent-text-field { padding: 12px 0; border-bottom: 1px solid var(--border-soft); }
    .settings-with-subnav .agent-text-field:last-of-type { border-bottom: 0; }
    .workspace-settings-section { border-top: 1px solid var(--border-soft); padding-top: 12px; }
    .workspace-settings-section + .workspace-settings-section { margin-top: 16px; }
    .workspace-trash-section { padding-bottom: 2px; }
    .workspace-settings-section h3 { margin: 0 0 10px; color: var(--text-strong); font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .workspace-settings-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--border-soft); }
    .workspace-settings-row:first-of-type { border-top: 0; }
    .workspace-settings-row.trashed { opacity: .82; }
    .workspace-settings-main { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .workspace-settings-name, .workspace-name-input { color: var(--text-strong); font-size: 14px; font-weight: 800; }
    .workspace-name-input { width: min(280px, 100%); min-height: var(--control-h); border: 1px solid var(--border); border-radius: 8px; background: var(--field); padding: 0 var(--control-px); font: inherit; font-size: var(--control-fs); outline: 0; }
    .workspace-name-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
    .workspace-settings-path, .workspace-settings-meta { min-width: 0; white-space: normal; word-break: break-all; color: var(--muted); font-size: 12px; }
    .workspace-settings-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
    .workspace-settings-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
    .workspace-settings-footer .setting-sub { display: block; margin-top: 3px; }
    .settings-with-subnav [data-pref="accentColor"]::before { content: ''; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
    .settings-with-subnav [data-pref="accentColor"][data-value="indigo"]::before { background: #818cf8; }
    .settings-with-subnav [data-pref="accentColor"][data-value="violet"]::before { background: #a78bfa; }
    .settings-with-subnav [data-pref="accentColor"][data-value="blue"]::before { background: #60a5fa; }
    .settings-with-subnav [data-pref="accentColor"][data-value="teal"]::before { background: #2dd4bf; }
    .settings-with-subnav [data-pref="accentColor"][data-value="rose"]::before { background: #fb7185; }
    .settings-with-subnav [data-pref="accentColor"][data-value="amber"]::before { background: #fbbf24; }
    .messages-page .thread-head { padding: 10px 14px; }
    .messages-page .thread-title { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .messages-page .thread-body { padding: 12px 16px; }
    .messages-page .compose { padding: 10px 14px; }
    .messages-page .message-composer { position: relative; display: block; width: 100%; flex: 0 0 auto; padding: 10px 14px 12px; border-top: 1px solid var(--border); background: var(--surface); }
    .message-composer-resize { position: absolute; left: 0; right: 0; top: -5px; z-index: 3; height: 10px; cursor: row-resize; touch-action: none; }
    .channel-thread-sidebar .message-composer-resize { left: 10px; }
    .message-composer-resize::after { content: ''; position: absolute; left: 50%; top: 4px; width: 52px; height: 3px; border-radius: 999px; background: transparent; transform: translateX(-50%); transition: background .12s ease, opacity .12s ease; opacity: .65; }
    .message-composer-resize:hover::after, .message-ui-resizing .message-composer-resize::after { background: var(--accent); opacity: 1; }
    .message-composer-box { display: flex; width: 100%; flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: 15px; background: var(--field); box-shadow: 0 12px 30px rgb(15 23 42 / .08); }
    .message-composer-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent), 0 14px 34px rgb(15 23 42 / .10); }
    .message-composer textarea { width: 100%; height: var(--message-composer-height, 118px); min-height: 76px; max-height: min(320px, 42vh); resize: none; border: 0; background: transparent; color: var(--text); padding: 12px 14px; font: inherit; line-height: 1.45; outline: 0; }
    .message-composer textarea:disabled { cursor: not-allowed; opacity: .68; }
    .message-composer-controls { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 45px; padding: 7px 8px 8px; border-top: 1px solid var(--border-soft); background: color-mix(in srgb, var(--surface-soft) 74%, transparent); }
    .message-composer-tools, .message-composer-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .message-composer-tools { flex: 1 1 auto; min-height: 32px; }
    .message-composer-actions { flex: 0 0 auto; margin-left: auto; }
    .message-composer .message-length-counter { align-self: auto; }
    .message-composer-send-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; min-width: 34px; padding: 0; border-radius: 999px; }
    .message-composer-send-svg { width: 18px; height: 18px; display: block; }
    .messages-page .conversation { padding: 10px 12px; }
    .messages-mobile-back { display: none; }
    .messages-page .bubble { margin-bottom: 10px; }
    .agent-avatar-presence { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; line-height: 0; vertical-align: middle; }
    .agent-avatar-presence .role-avatar { width: 100%; height: 100%; }
    .avatar-presence-dot { position: absolute; right: -2px; bottom: -2px; width: var(--avatar-presence-size, 9px); height: var(--avatar-presence-size, 9px); border: 2px solid var(--surface); border-radius: 999px; background: #9ca3af; box-shadow: 0 0 0 1px rgb(15 23 42 / .18); }
    .avatar-presence-dot.online { background: var(--green); }
    .avatar-presence-dot.offline { background: #9ca3af; }
    .human-avatar { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 7px; background: var(--accent-light); color: var(--accent-dark); font-family: var(--font-mono); font-weight: 800; line-height: 1; }
    .message-bubble-row { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 10px; }
    .message-bubble-row.mine { justify-content: flex-end; }
    .message-bubble-row.mine .message-avatar { order: 2; }
    .message-bubble-row .bubble { margin-bottom: 0; }
    .message-bubble-row.mine .bubble { margin-left: 0; }
    .message-avatar { flex: 0 0 auto; }
    .messages-page.channel-mode { position: relative; height: 100%; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr); overflow: hidden; }
    .messages-page.channel-mode.thread-open { grid-template-columns: minmax(0, 1fr) var(--channel-thread-width, clamp(320px, 32vw, 420px)); }
    .messages-page.channel-mode > .message-tabbar { grid-column: 1 / -1; grid-row: 1; }
    .messages-page.channel-mode .channel-panel { grid-column: 1; grid-row: 2; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .channel-head { align-items: center; }
    .channel-head-main { min-width: 0; }
    .channel-head h2 { margin: 0; font-size: 16px; }
    .channel-head p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .channel-head-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .channel-export-menu .launch-menu { min-width: 170px; }
    .channel-thread { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px 0; background: var(--surface); }
    .channel-message-row { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--border-soft); }
    .channel-message-row:hover, .channel-message-row.active-thread { background: var(--surface-soft); }
    .channel-message-avatar { padding-top: 2px; }
    .channel-human-avatar { width: 28px; height: 28px; background: var(--accent-light); color: var(--accent-dark); font-size: 10px; }
    .channel-message-meta { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .channel-message-sender { color: var(--text-strong); font-size: 13px; font-weight: 800; }
    .channel-message-time, .channel-message-id { color: var(--muted); font-size: 11px; }
    .channel-message-body { margin-top: 3px; color: var(--text); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .channel-message-body p { margin: 0 0 8px; }
    .channel-message-body p:last-child { margin-bottom: 0; }
    .channel-message-body ul, .channel-message-body ol { margin: 4px 0 8px 18px; padding: 0; }
    .channel-message-body code { padding: 1px 4px; border: 1px solid var(--border-soft); border-radius: 5px; background: var(--surface-soft); font-family: var(--font-mono); font-size: 12px; }
    .channel-message-body pre { margin: 6px 0 8px; padding: 9px 10px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); overflow: auto; }
    .channel-message-body pre code { padding: 0; border: 0; background: transparent; }
    .channel-message-body a { color: var(--accent-dark); text-decoration: underline; text-underline-offset: 2px; }
    .channel-message-actions { display: flex; align-items: center; gap: 10px; min-height: 18px; margin-top: 5px; opacity: .65; }
    .channel-message-row:hover .channel-message-actions, .channel-sidebar-message:hover .channel-message-actions { opacity: 1; }
    .channel-message-actions button, .channel-thread-count { border: 0; background: transparent; color: var(--muted); padding: 0; font-size: 11px; font-weight: 800; cursor: pointer; }
    .channel-message-actions button:hover, .channel-thread-count:hover { color: var(--accent-dark); text-decoration: underline; text-underline-offset: 2px; }
    .channel-compose { flex: 0 0 auto; }
    .channel-thread-sidebar { position: relative; grid-column: 2; grid-row: 1 / span 2; min-width: 0; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--surface); box-shadow: -18px 0 34px rgb(15 23 42 / .08); }
    .channel-thread-sidebar-resize { position: absolute; left: -5px; top: 0; bottom: 0; z-index: 4; width: 10px; cursor: col-resize; touch-action: none; }
    .channel-thread-sidebar-resize::after { content: ''; position: absolute; left: 4px; top: 12px; bottom: 12px; width: 3px; border-radius: 999px; background: transparent; transition: background .12s ease, opacity .12s ease; opacity: .65; }
    .channel-thread-sidebar-resize:hover::after, .message-ui-resizing .channel-thread-sidebar-resize::after { background: var(--accent); opacity: 1; }
    .channel-thread-sidebar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
    .channel-thread-sidebar-head h3 { margin: 0; color: var(--text-strong); font-size: 15px; }
    .channel-thread-sidebar-head p { margin: 3px 0 0; color: var(--muted); font-size: 11px; }
    .channel-thread-sidebar-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px 0; }
    .channel-sidebar-message { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 9px; padding: 10px 14px; border-bottom: 1px solid var(--border-soft); }
    .channel-sidebar-message:hover { background: var(--surface-soft); }
    .channel-thread-sidebar-compose { padding: 10px 12px 12px; }
    .bubble-body { color: inherit; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .bubble-body p { margin: 0 0 8px; }
    .bubble-body p:last-child { margin-bottom: 0; }
    .bubble-body ul, .bubble-body ol { margin: 4px 0 8px 18px; padding: 0; }
    .bubble-body code { padding: 1px 5px; border: 1px solid var(--border-soft); border-radius: 5px; background: var(--surface-soft); color: var(--text); font-family: var(--font-mono); font-size: 12px; }
    .bubble-body pre { margin: 6px 0 8px; padding: 9px 10px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); overflow: auto; }
    .bubble-body pre code { padding: 0; border: 0; background: transparent; color: var(--text); }
    .bubble-body a { color: var(--accent-dark); text-decoration: underline; text-underline-offset: 2px; }
    .bubble-body strong { font-weight: 700; }
    .bubble.mine .bubble-body code { background: color-mix(in srgb, #fff 20%, transparent); border-color: color-mix(in srgb, #fff 30%, transparent); color: #fff; }
    .bubble.mine .bubble-body pre { background: color-mix(in srgb, #fff 16%, transparent); border-color: color-mix(in srgb, #fff 26%, transparent); }
    .bubble.mine .bubble-body pre code { color: #fff; }
    .bubble.mine .bubble-body a { color: #fff; }
    .bubble.rejected .bubble-body { color: var(--red-text); }
    .bubble.rejected .bubble-body code, .bubble.mine.rejected .bubble-body code { background: color-mix(in srgb, var(--red-soft-bg) 60%, transparent); border-color: var(--red-soft-border); color: var(--red-text); }
    .bubble.rejected .bubble-body pre, .bubble.mine.rejected .bubble-body pre { background: color-mix(in srgb, var(--red-soft-bg) 60%, transparent); border-color: var(--red-soft-border); }
    .bubble.rejected .bubble-body pre code, .bubble.mine.rejected .bubble-body pre code { color: var(--red-text); }
    .bubble.rejected .bubble-body a, .bubble.mine.rejected .bubble-body a { color: var(--red-text); text-decoration-color: color-mix(in srgb, var(--red-text) 70%, transparent); }
    :root[data-theme="dark"] .messages-page .bubble { background: #1f2937; border-color: #334155; color: #f8fafc; box-shadow: 0 10px 24px rgb(0 0 0 / .22); }
    :root[data-theme="dark"] .messages-page .bubble.mine { background: var(--accent-light); border-color: var(--accent); color: var(--text-strong); }
    :root[data-theme="dark"] .messages-page .bubble-meta { color: #cbd5e1; }
    :root[data-theme="dark"] .messages-page .bubble.mine .bubble-meta { color: var(--accent-dark); }
    :root[data-theme="dark"] .messages-page .bubble.rejected { background: #3b1518; border-color: #7f1d1d; color: #fecaca; }
    :root[data-theme="dark"] .messages-page .bubble.mine.rejected { background: #3b1518; border-color: #7f1d1d; color: #fecaca; }
    :root[data-theme="dark"] .messages-page .bubble.mine.rejected .bubble-meta, :root[data-theme="dark"] .messages-page .bubble.rejected .bubble-meta { color: #fecaca; }
    @media (prefers-color-scheme: dark) { :root[data-theme="auto"] .messages-page .bubble { background: #1f2937; border-color: #334155; color: #f8fafc; box-shadow: 0 10px 24px rgb(0 0 0 / .22); } :root[data-theme="auto"] .messages-page .bubble.mine { background: var(--accent-light); border-color: var(--accent); color: var(--text-strong); } :root[data-theme="auto"] .messages-page .bubble-meta { color: #cbd5e1; } :root[data-theme="auto"] .messages-page .bubble.mine .bubble-meta { color: var(--accent-dark); } :root[data-theme="auto"] .messages-page .bubble.rejected { background: #3b1518; border-color: #7f1d1d; color: #fecaca; } :root[data-theme="auto"] .messages-page .bubble.mine.rejected { background: #3b1518; border-color: #7f1d1d; color: #fecaca; } :root[data-theme="auto"] .messages-page .bubble.mine.rejected .bubble-meta, :root[data-theme="auto"] .messages-page .bubble.rejected .bubble-meta { color: #fecaca; } }

    .agent-list-overview { display: flex; flex-direction: column; gap: 0; height: 100%; min-height: 0; overflow: auto; }
    .agent-sortbar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--surface); color: var(--muted); font-size: 13px; }
    .runtime-settings .settings-dropdown, .runtime-global .settings-dropdown { min-width: 190px; }
    .repo-group-list { display: flex; flex-direction: column; gap: 0; }
    .repo-group { border-bottom: 1px solid var(--border); background: var(--surface); }
    .repo-group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; padding: 9px 14px; border-bottom: 1px solid var(--border-soft); background: var(--surface-soft); color: var(--text-strong); font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .repo-group-head small { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: none; }
    .repo-group .agent-row:last-child { border-bottom: 0; }
    .agent-row-list { display: flex; flex-direction: column; gap: 0; }
    .agent-row { display: flex; align-items: center; gap: 14px; min-height: 88px; padding: 12px 14px; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: var(--surface); box-shadow: none; }
    .agent-row.missing { opacity: .55; background: var(--surface-soft); }
    /* EP-003 WA-011: identicon-backed avatar wrapper. The legacy 5x5 cell grid was replaced by an identiconFor() SVG; this rule now just sizes + clips the wrapper so the inner SVG fills it. */
    .role-avatar { width: 48px; height: 48px; flex: 0 0 auto; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); overflow: hidden; background: var(--surface); }
    .role-avatar > svg { display: block; width: 100%; height: 100%; }
    .agent-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .agent-row-title { display: flex; align-items: center; gap: 8px; font-weight: 750; color: var(--text-strong); }
    .agent-row-path { color: var(--text); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-row-runtime { color: var(--text); font-size: 14px; }
    .agent-row-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; }
    .agent-sort-menu { z-index: 1; }
    .agent-sort-menu:has(.launch-menu) { z-index: 90; }
    .agent-sort-menu .agent-sort-trigger { min-width: 150px; justify-content: flex-start; }
    .agent-sort-menu .agent-sort-trigger strong { color: var(--text-strong); font-size: 12px; }
    .agent-sort-menu .launch-menu { left: 0; right: auto; min-width: 190px; }
    .badge.online { background: oklch(95% 0.04 150); color: oklch(38% 0.14 150); border-color: oklch(86% 0.07 150); }
    .agent-sort-options button { justify-content: flex-start; }
    .agent-sort-options button.active { background: var(--accent-light); color: var(--accent-dark); }
    .agent-sort-options span { font-size: 12px; font-weight: 750; }
    .runtime-settings, .runtime-global, .diagnostics-info, .diagnostics-runners { display: flex; flex-direction: column; gap: 0; }
    .settings-save-bar { position: sticky; bottom: 0; z-index: 12; display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 14px; min-height: 64px; margin-top: auto; padding: 11px 20px; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, transparent); box-shadow: 0 -12px 24px rgb(15 23 42 / .08); backdrop-filter: blur(12px); }
    .settings-save-status { min-width: 0; color: var(--muted); font-size: 12px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .settings-save-actions { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 10px; }
    .runtime-command.setting-row { align-items: start; padding: 16px 0; }
    .runtime-command-controls { display: grid; gap: 12px; width: 100%; }
    .runtime-enabled-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: var(--control-h); padding: 0 12px; border: 1px solid var(--border-soft); border-radius: 9px; background: var(--surface-soft); cursor: pointer; user-select: none; }
    .runtime-enabled-row .runtime-field-label { font-size: 11px; font-weight: 800; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
    .runtime-enabled-row input[type="checkbox"] { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
    .runtime-enabled-row:has(input[disabled]) { opacity: .55; cursor: not-allowed; }
    .runtime-detect-chip { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; text-transform: none; letter-spacing: 0; }
    .runtime-detect-chip.detect-ok { background: color-mix(in srgb, var(--green, #22c55e) 18%, transparent); color: var(--green-dark, #15803d); }
    .runtime-detect-chip.detect-missing { background: color-mix(in srgb, #ef4444 18%, transparent); color: #b91c1c; }
    .runtime-detect-chip.detect-error { background: color-mix(in srgb, #f59e0b 22%, transparent); color: #b45309; }
    .runtime-detect-chip.detect-pending { background: color-mix(in srgb, var(--muted) 18%, transparent); color: var(--muted); }
    .runtime-command-preview-input { font-family: var(--font-mono); }
    .runtime-redetect-row { display: flex; align-items: center; gap: 12px; padding: 12px 0 4px; border-top: 1px dashed var(--border); margin-top: 6px; }
    .runtime-redetect-help { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .launch-menu-empty { padding: 8px 12px; color: var(--muted); font-size: 11px; line-height: 1.35; }
    .runtime-command-controls { width: 100%; display: grid; gap: 10px; }
    .runtime-command-fields { display: grid; grid-template-columns: minmax(120px, .42fr) minmax(180px, .58fr); gap: 10px; }
    .runtime-field { display: flex; flex-direction: column; gap: 5px; color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .runtime-field input, .runtime-field textarea { width: 100%; min-height: var(--control-h); border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); padding: 0 var(--control-px); font-family: var(--font-mono); font-size: var(--control-fs); outline: 0; }
    .runtime-field textarea { min-height: 78px; resize: vertical; line-height: 1.35; }
    .runtime-field input:focus, .runtime-field textarea:focus, .runtime-settings .settings-dropdown-trigger:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
    .command-preview { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border-soft); border-radius: 9px; background: var(--surface-soft); }
    .command-preview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .command-preview-title { color: var(--text-strong); font-size: 12px; font-weight: 800; }
    .command-preview-help { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .command-preview code { display: block; overflow: auto; padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--field); color: var(--text); font-family: var(--font-mono); font-size: 12px; line-height: 1.4; white-space: pre; }
    .launch-command-preview { margin: -10px 0 18px; }
    .policy-setting { align-items: start; }
    .policy-card-grid { display: grid; grid-template-columns: 1fr; gap: 8px; width: 100%; }
    .policy-card { min-height: auto; padding: 11px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); text-align: left; }
    .policy-card.active { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .policy-card span { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 800; }
    .policy-card small { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .peer-policy-controls { width: 100%; display: flex; flex-direction: column; gap: 10px; }
    .peer-mode-segment { justify-content: flex-start; }
    .peer-rule-add { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr) auto; gap: 8px; align-items: center; }
    .peer-rule-add .settings-dropdown { width: 100%; min-width: 0; }
    .peer-rule-list { display: flex; flex-direction: column; gap: 6px; }
    .peer-rule-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 9px; background: var(--surface-soft); color: var(--text); font-size: 12px; }
    .peer-rule-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .peer-rule-empty { padding: 9px 10px; border: 1px dashed var(--border); border-radius: 9px; color: var(--muted); font-size: 12px; }
    .settings-kv-wrap { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
    .default-runtime-modal { width: min(500px, 100%); }
    .runtime-default-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 16px 0; }
    .runtime-default-choice { min-height: 84px; border-radius: 0; }
    .runtime-default-choice.pill { border-radius: 999px; }
    .runtime-choice-head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 13px; font-weight: 800; }
    .runtime-choice-sub { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .content:has(.kanban-page) { padding: 0; }
    .kanban-page { height: 100%; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); background: var(--surface-soft); overflow: hidden; }
    .kanban-page.detail-open { grid-template-columns: minmax(0, 1fr) minmax(360px, 29vw); }
    .kanban-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .kanban-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid var(--border); background: linear-gradient(135deg, color-mix(in srgb, var(--accent-light) 72%, var(--surface)) 0%, var(--surface) 54%); }
    .kanban-kicker { margin: 0 0 4px; color: var(--accent-dark); font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .kanban-hero h1, .kanban-detail h2 { margin: 0; color: var(--text-strong); font-size: 24px; line-height: 1.1; }
    .kanban-hero p { max-width: 720px; margin: 6px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .kanban-stats { display: grid; grid-template-columns: repeat(4, minmax(74px, auto)); gap: 8px; }
    .kanban-stats span { display: flex; flex-direction: column; gap: 2px; min-width: 74px; padding: 9px 10px; border: 1px solid var(--border-soft); border-radius: 12px; background: color-mix(in srgb, var(--surface) 84%, transparent); color: var(--muted); font-size: 11px; }
    .kanban-stats strong { color: var(--text-strong); font-size: 18px; line-height: 1; }
    .kanban-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .kanban-toolbar input, .kanban-toolbar select, .kanban-prefix-control input { min-height: var(--control-h); border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); padding: 0 var(--control-px); font: inherit; font-size: var(--control-fs); outline: 0; }
    .kanban-toolbar input:focus, .kanban-toolbar select:focus, .kanban-prefix-control input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
    .kanban-search { flex: 1 1 240px; }
    .kanban-search input { width: 100%; }
    .kanban-archived-toggle { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .kanban-matrix { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; grid-template-columns: 180px repeat(var(--kanban-status-count), minmax(220px, 1fr)); align-content: start; }
    .kanban-corner, .kanban-status-head, .kanban-lane-head, .kanban-cell { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .kanban-corner, .kanban-status-head { position: sticky; top: 0; z-index: 5; min-height: 42px; background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(10px); }
    .kanban-corner { left: 0; z-index: 7; display: flex; align-items: center; padding: 10px 12px; color: var(--muted); font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; }
    .kanban-status-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; color: var(--text-strong); font-size: 12px; font-weight: 900; }
    .kanban-status-head span { color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
    .kanban-lane-head { position: sticky; left: 0; z-index: 4; display: flex; align-items: center; gap: 9px; min-height: 112px; padding: 10px 12px; background: var(--surface); }
    .kanban-lane-head strong { display: block; color: var(--text-strong); font-size: 13px; }
    .kanban-lane-head span { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
    .kanban-cell { min-height: 112px; padding: 8px; background: color-mix(in srgb, var(--surface-soft) 72%, var(--surface)); }
    .kanban-card { display: flex; width: 100%; flex-direction: column; gap: 7px; margin-bottom: 8px; padding: 10px 11px; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; background: var(--surface); color: var(--text); text-align: left; box-shadow: 0 10px 18px rgb(15 23 42 / .06); cursor: pointer; }
    .kanban-card:hover, .kanban-card.selected { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); border-left-color: var(--accent-dark); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent), 0 12px 24px rgb(15 23 42 / .08); }
    .kanban-card.priority-p0 { border-left-color: var(--red); }
    .kanban-card.priority-p1 { border-left-color: var(--amber); }
    .kanban-card.priority-p2 { border-left-color: var(--yellow); }
    .kanban-card.priority-p3 { border-left-color: var(--green); }
    .kanban-card.archived { opacity: .62; }
    .kanban-card-top, .kanban-card-meta, .kanban-detail-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .kanban-id { color: var(--accent-dark); font-family: var(--font-mono); font-size: 11px; font-weight: 900; }
    .kanban-pill { display: inline-flex; align-items: center; width: max-content; min-height: var(--control-h-sm); padding: 0 7px; border: 1px solid var(--border-soft); border-radius: 999px; background: var(--surface-soft); color: var(--muted); font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .03em; }
    .kanban-pill.status { color: var(--accent-dark); background: var(--accent-light); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
    .kanban-pill.archived { color: var(--red); }
    .kanban-pill.github { color: var(--text); }
    .kanban-card strong { color: var(--text-strong); font-size: 13px; line-height: 1.3; }
    .kanban-card-detail { color: var(--muted); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .kanban-card-meta { justify-content: space-between; color: var(--muted); font-size: 11px; }
    .kanban-detail { min-width: 0; min-height: 0; overflow: auto; border-left: 1px solid var(--border); background: var(--surface); box-shadow: -18px 0 34px rgb(15 23 42 / .08); }
    .kanban-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; background: var(--surface); }
    .kanban-detail-head h2 { font-size: 19px; line-height: 1.25; }
    .kanban-detail-badges, .kanban-detail-grid, .kanban-detail section, .kanban-github { margin: 14px 16px 0; }
    .kanban-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .kanban-detail-grid div { padding: 9px 10px; border: 1px solid var(--border-soft); border-radius: 10px; background: var(--surface-soft); }
    .kanban-detail-grid span { display: block; color: var(--muted); font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }
    .kanban-detail-grid strong { display: block; margin-top: 3px; color: var(--text-strong); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-detail-grid .kanban-detail-persona { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; font-weight: 600; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: 0; }
    .kanban-github { display: block; color: var(--accent-dark); font-size: 12px; font-weight: 800; text-decoration: underline; text-underline-offset: 2px; }
    .kanban-detail section { padding-top: 14px; border-top: 1px solid var(--border-soft); }
    .kanban-detail h3 { margin: 0 0 8px; color: var(--text-strong); font-size: 13px; }
    .kanban-detail-text, .kanban-comment-body { margin: 0; color: var(--text); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .kanban-detail-text p, .kanban-comment-body p { margin: 0 0 8px; }
    .kanban-detail-text p:last-child, .kanban-comment-body p:last-child { margin-bottom: 0; }
    .kanban-detail-text ul, .kanban-detail-text ol, .kanban-comment-body ul, .kanban-comment-body ol { margin: 4px 0 8px 18px; padding: 0; }
    .kanban-detail-text code, .kanban-comment-body code { padding: 1px 5px; border: 1px solid var(--border-soft); border-radius: 5px; background: var(--surface-soft); color: var(--text); font-family: var(--font-mono); font-size: 12px; }
    .kanban-detail-text pre, .kanban-comment-body pre { margin: 6px 0 8px; padding: 9px 10px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); overflow: auto; }
    .kanban-detail-text pre code, .kanban-comment-body pre code { padding: 0; border: 0; background: transparent; }
    .kanban-detail-text a, .kanban-comment-body a { color: var(--accent-dark); text-decoration: underline; text-underline-offset: 2px; }
    .kanban-empty-line { color: var(--muted); font-size: 12px; }
    .kanban-linked-list, .kanban-comments, .kanban-activity { display: flex; flex-direction: column; gap: 8px; }
    .kanban-linked-list button { display: flex; flex-direction: column; gap: 3px; padding: 9px 10px; border: 1px solid var(--border-soft); border-radius: 10px; background: var(--surface-soft); color: var(--text); text-align: left; }
    .kanban-linked-list button:hover { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .kanban-linked-list strong { font-family: var(--font-mono); font-size: 11px; }
    .kanban-linked-list span { font-size: 12px; }
    .kanban-comment { padding: 10px; border: 1px solid var(--border-soft); border-radius: 10px; background: var(--surface-soft); }
    .kanban-comment.blocker { border-color: color-mix(in srgb, var(--red) 45%, var(--border)); background: color-mix(in srgb, var(--red) 9%, var(--surface)); }
    .kanban-comment > div:not(.kanban-comment-body) { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
    .kanban-comment strong { color: var(--text-strong); font-size: 12px; }
    .kanban-comment span, .kanban-activity span, .kanban-activity em { color: var(--muted); font-size: 11px; font-style: normal; }
    .kanban-activity div { display: grid; grid-template-columns: 92px minmax(0, .8fr) minmax(0, 1fr); gap: 8px; align-items: baseline; color: var(--text); font-size: 12px; }
    .kanban-prefix-control { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .kanban-prefix-control input { width: 140px; text-transform: uppercase; }
    @media (max-width: 960px) { .kanban-page.detail-open { grid-template-columns: minmax(0, 1fr); } .kanban-detail { position: absolute; inset: auto 0 0 0; z-index: 35; max-height: 78%; border-left: 0; border-top: 1px solid var(--border); box-shadow: 0 -18px 34px rgb(15 23 42 / .18); } .kanban-hero { align-items: stretch; flex-direction: column; } .kanban-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .settings-subnav-item.term-tab { min-width: 0; padding: 0 12px; } .settings-with-subnav .setting-row { grid-template-columns: 1fr; gap: 5px; } .settings-with-subnav .setting-row > :last-child { grid-column: 1; grid-row: auto; } .settings-save-bar { align-items: stretch; flex-direction: column; padding: 10px 12px; } .settings-save-status { white-space: normal; } .settings-save-actions { width: 100%; } .settings-save-actions .btn { flex: 1 1 0; } .agent-row { align-items: flex-start; gap: 12px; padding: 10px 12px; } .role-avatar { width: 42px; height: 42px; padding: 6px; } .agent-row-actions { width: 100%; justify-content: flex-start; } .runtime-command-fields, .policy-card-grid, .runtime-default-grid, .peer-rule-add { grid-template-columns: 1fr; } .peer-rule-row { grid-template-columns: 1fr; } .messages-page.channel-mode.thread-open { grid-template-columns: minmax(0, 1fr); } .messages-page .message-composer { padding: 8px 10px 10px; } .channel-thread-sidebar { position: absolute; grid-column: auto; left: 0; right: 0; bottom: 0; z-index: 30; width: auto; min-width: 0; max-height: 72%; border-left: 0; border-top: 1px solid var(--border); box-shadow: 0 -18px 34px rgb(15 23 42 / .18); } .channel-thread-sidebar-resize { display: none; } .channel-thread-sidebar-head { padding: 10px 12px; } .kanban-matrix { display: flex; flex-direction: column; overflow: auto; } .kanban-corner, .kanban-status-head { display: none; } .kanban-lane-head { position: static; min-height: auto; border-right: 0; } .kanban-cell { min-height: auto; border-right: 0; } .kanban-cell::before { content: attr(data-status); display: block; margin-bottom: 8px; color: var(--muted); font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; } .kanban-detail-grid { grid-template-columns: 1fr; } .kanban-activity div { grid-template-columns: 1fr; gap: 2px; } }

    @media (max-width: 760px) { .messages-page { height: 100%; min-height: 0; } .messages-page .inbox-panel { height: 100%; min-height: 0; display: flex; overflow: hidden; } .messages-page .conversation-list, .messages-page .thread-panel, .messages-page.channel-mode .channel-panel { min-width: 0; min-height: 0; } .messages-page .thread-panel, .messages-page.channel-mode .channel-panel { display: flex; flex-direction: column; flex: 1 1 auto; } .messages-page .thread-body, .messages-page .channel-thread, .channel-thread-sidebar-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; } .messages-mobile-back { display: inline-flex; flex: 0 0 auto; } .messages-page.mobile-messages-list .thread-panel { display: none; } .messages-page.mobile-messages-thread .conversation-list { display: none; } .messages-page.mobile-messages-list .conversation-list { flex: 1 1 auto; width: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; } .messages-page.mobile-messages-thread .thread-panel { flex: 1 1 auto; width: 100%; } .messages-page.channel-mode.thread-open .channel-panel { display: none; } .messages-page.channel-mode.thread-open .channel-thread-sidebar { position: absolute; inset: 44px 0 0 0; width: auto; max-height: none; border-left: 0; border-top: 0; box-shadow: none; } }

    .kanban-page { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--surface-soft); overflow: hidden; }
    /* WA-048: explicit grid placement so the tabbar + toolbar still span
       full width when the task drawer opens; without this, grid auto-flow
       distributes children into both columns and the board jumps below
       the drawer. */
    .kanban-page.detail-open { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 29vw); grid-template-rows: auto 1fr; }
    .kanban-page.detail-open .kanban-tabbar { grid-column: 1 / -1; grid-row: 1; }
    .kanban-page.detail-open .kanban-main { grid-column: 1; grid-row: 2; min-width: 0; }
    .kanban-page.detail-open .kanban-detail { grid-column: 2; grid-row: 2; }
    .kanban-main { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .kanban-head { min-height: 43px; display: flex; align-items: center; padding: 0 14px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .kanban-head h2 { margin: 0; color: var(--text-strong); font-size: 15px; font-weight: 850; letter-spacing: -.01em; }
    .kanban-toolbar { flex: 0 0 auto; padding: 9px 12px; }
    .kanban-board { --kanban-agent-width: 160px; --kanban-status-min: 200px; --kanban-status-count: 6; --kanban-status-total-min: 1200px; flex: 1 1 auto; min-height: 0; margin: 0; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: var(--surface); overflow: auto; }
    .kanban-board-head, .kanban-row { display: grid; grid-template-columns: var(--kanban-agent-width) minmax(var(--kanban-status-total-min), 1fr); min-width: calc(var(--kanban-agent-width) + var(--kanban-status-total-min)); }
    .kanban-board-head { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 96%, transparent); backdrop-filter: blur(10px); }
    .kanban-board-agent-head { position: sticky; left: 0; z-index: 12; padding: 10px 0 10px 14px; border-right: 1px solid var(--border); background: inherit; color: var(--muted); font-size: 11px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
    .kanban-board-status-heads, .kanban-row-cells { display: grid; grid-template-columns: repeat(var(--kanban-status-count), minmax(var(--kanban-status-min), 1fr)); gap: 0; min-width: 0; padding-right: 0; }
    .kanban-board-status-heads { align-items: center; padding-top: 10px; padding-bottom: 10px; }
    .kanban-board-status-head { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 0 10px; border-right: 1px solid var(--border-soft); color: var(--text-strong); font-size: 11px; font-weight: 850; letter-spacing: .04em; text-transform: uppercase; }
    .kanban-board-status-head strong { color: var(--muted); font-family: var(--font-mono); font-size: 10px; }
    .kanban-board-rows { display: flex; flex-direction: column; border-bottom: 1px solid var(--border); }
    .kanban-row { min-height: 112px; align-items: stretch; border-bottom: 1px solid var(--border-soft); padding: 0; }
    .kanban-row:last-child { border-bottom: 0; }
    .kanban-lane-head { position: sticky; left: 0; z-index: 8; min-height: auto; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 7px; padding: 12px 14px; border: 0; border-right: 1px solid var(--border); background: var(--surface); text-align: left; }
    .kanban-lane-agent { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    /* EP-003 WA-012: lane head shows repoName above roleName so cross-repo same-bare-name agents stay distinct. */
    .kanban-lane-agent .kanban-lane-agent-text { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
    .kanban-lane-agent .kanban-lane-agent-label { display: flex; flex-direction: column; min-width: 0; gap: 0; line-height: 1.15; }
    .kanban-lane-agent .kanban-lane-agent-repo { color: var(--muted); font-size: 10px; font-weight: 600; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-lane-agent .kanban-lane-agent-name { display: block; color: var(--text-strong); font-size: 12.5px; font-weight: 800; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-lane-agent .kanban-lane-agent-desc { display: block; max-width: 150px; color: var(--muted); font-size: 10px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-lane-agent .kanban-lane-agent-count { display: block; margin-top: 1px; color: var(--muted); font-size: 10px; }
    .kanban-progress { height: 3px; max-width: 132px; overflow: hidden; border-radius: 999px; background: var(--border-soft); }
    .kanban-progress span { display: block; height: 100%; border-radius: inherit; background: var(--green); }
    .kanban-cell { min-height: 112px; max-height: 280px; display: flex; flex-direction: column; padding: 0; border: 0; border-right: 1px solid var(--border-soft); border-radius: 0; background: transparent; overflow: hidden; }
    .kanban-cell::before { content: none; display: none; }
    .kanban-cell-head { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; min-height: 29px; padding: 5px 9px 4px; border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 84%, transparent); color: var(--muted); font-size: 10px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
    .kanban-cell-head strong { margin-left: auto; padding: 0 5px; border-radius: 4px; background: color-mix(in srgb, var(--surface) 74%, var(--border-soft)); color: var(--muted); font-family: var(--font-mono); font-size: 10px; }
    .kanban-status-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 999px; background: var(--kanban-status-accent, #94a3b8); }
    .kanban-cell-scroll { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; padding: 8px; }
    .kanban-cell-empty { padding: 11px 0; color: color-mix(in srgb, var(--muted) 70%, transparent); font-size: 11px; text-align: center; }
    .kanban-status-backlog { --kanban-status-accent: oklch(75% 0.03 270); --kanban-status-bg: oklch(97% 0.008 270); }
    .kanban-status-queued { --kanban-status-accent: oklch(68% 0.16 245); --kanban-status-bg: oklch(97% 0.025 245); }
    .kanban-status-in-progress { --kanban-status-accent: oklch(65% 0.18 285); --kanban-status-bg: oklch(97% 0.025 285); }
    .kanban-status-review { --kanban-status-accent: oklch(62% 0.16 55); --kanban-status-bg: oklch(97.5% 0.02 75); }
    .kanban-status-blocked { --kanban-status-accent: var(--red); --kanban-status-bg: color-mix(in srgb, var(--red) 8%, var(--surface)); }
    .kanban-status-completed { --kanban-status-accent: oklch(58% 0.14 150); --kanban-status-bg: oklch(97% 0.02 150); }
    .kanban-card { flex: 0 0 auto; gap: 6px; margin: 0; padding: 9px 10px; border-radius: 8px; border-left-width: 3px; box-shadow: 0 1px 3px rgb(15 23 42 / .04); transition: box-shadow .12s, transform .12s, border-color .12s; }
    .kanban-card:hover, .kanban-card.selected { transform: translateY(-1px); box-shadow: 0 2px 10px rgb(15 23 42 / .08); }
    .kanban-card-title { display: -webkit-box; overflow: hidden; color: var(--text-strong); font-size: 12.5px; font-weight: 750; line-height: 1.35; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .kanban-card-meta { display: flex; align-items: center; justify-content: flex-start; gap: 5px; min-width: 0; flex-wrap: nowrap; }
    .kanban-pill { min-height: var(--control-h-sm); padding: 0 6px; border-radius: 999px; font-size: 10px; letter-spacing: .02em; }
    .kanban-pill.effort { text-transform: none; }
    .kanban-pill.effort-xs {
      background: color-mix(in oklch, var(--accent) 6%, var(--surface));
      color: color-mix(in oklch, var(--accent) 32%, var(--muted));
      border: 1px solid color-mix(in oklch, var(--accent) 12%, var(--border));
    }
    .kanban-pill.effort-s {
      background: color-mix(in oklch, var(--accent) 14%, var(--surface));
      color: color-mix(in oklch, var(--accent) 60%, var(--text));
      border: 1px solid color-mix(in oklch, var(--accent) 22%, var(--border));
    }
    .kanban-pill.effort-m {
      background: var(--accent-light);
      color: var(--accent-dark);
      border: 1px solid color-mix(in oklch, var(--accent) 38%, var(--border));
    }
    .kanban-pill.effort-l {
      background: color-mix(in oklch, var(--accent) 46%, var(--surface));
      color: color-mix(in oklch, var(--accent-dark) 70%, white 30%);
      border: 1px solid color-mix(in oklch, var(--accent) 62%, var(--border));
    }
    .kanban-pill.effort-xl {
      background: color-mix(in oklch, var(--accent) 72%, var(--surface));
      color: #fff;
      border: 1px solid var(--accent);
    }
    /* WA-056: epic + task status pills consume the same --kanban-status-accent
       / --kanban-status-bg vars the board lane heads use, so badge colour
       tracks the status semantics instead of staying grey. */
    .kanban-pill.kanban-status-backlog, .kanban-pill.kanban-status-queued, .kanban-pill.kanban-status-in-progress, .kanban-pill.kanban-status-review, .kanban-pill.kanban-status-blocked, .kanban-pill.kanban-status-completed { background: color-mix(in srgb, var(--kanban-status-accent) 14%, var(--surface)); color: var(--kanban-status-accent); border-color: color-mix(in srgb, var(--kanban-status-accent) 35%, var(--border)); }
    .kanban-id { margin-left: auto; color: var(--muted); font-family: var(--font-mono); font-size: 10px; font-weight: 800; }
    .kanban-detail-view { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 18px; --kanban-detail-width: 780px; }
    .kanban-back { margin: 0 0 12px max(0px, calc((100% - var(--kanban-detail-width)) / 2)); }
    .kanban-detail-card { max-width: var(--kanban-detail-width); margin: 0 auto; padding-bottom: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: 0 10px 28px rgb(15 23 42 / .07); }
    .kanban-detail-card h2 { margin: 0; color: var(--text-strong); font-size: 20px; line-height: 1.25; }
    .kanban-detail { min-width: 0; min-height: 0; overflow: auto; border-left: 1px solid var(--border); background: var(--surface); box-shadow: -18px 0 34px rgb(15 23 42 / .08); }

    @media (max-width: 960px) { .kanban-page.detail-open { display: flex; } .kanban-detail { position: absolute; inset: auto 0 0 0; z-index: 35; max-height: 78%; border-left: 0; border-top: 1px solid var(--border); box-shadow: 0 -18px 34px rgb(15 23 42 / .18); } }
    @media (max-width: 760px) { .kanban-head { min-height: 42px; padding: 0 12px; } .kanban-toolbar { align-items: stretch; padding: 8px 10px; } .kanban-toolbar .kanban-search, .kanban-toolbar input, .kanban-toolbar select, .kanban-toolbar button { width: 100%; } .kanban-board { --kanban-agent-width: 132px; --kanban-status-min: 190px; --kanban-status-total-min: 1140px; } .kanban-board-agent-head { padding-left: 10px; } .kanban-lane-head { padding: 10px; } .kanban-detail-view { padding: 12px; } .kanban-back { margin-left: 0; } }

    .agent-text-settings { display: flex; flex-direction: column; gap: 14px; }
    .agent-text-warning { padding: 10px 12px; border: 1px solid var(--amber-soft-border); border-radius: 12px; background: var(--amber-soft-bg); color: var(--amber-soft-text); font-size: 12px; line-height: 1.45; }
    .agent-text-warning.inline { margin-top: -4px; }
    .prompt-expander { overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
    .prompt-expander-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border-soft); }
    .prompt-expander-title { flex: 1 1 auto; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .prompt-expander-title .setting-sub { display: block; margin-top: 2px; }
    .prompt-expander-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px 14px; }
    .prompt-expander-body .setting-input { width: 100%; min-height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); font-family: var(--font-mono); font-size: var(--control-fs); outline: 0; }
    .prompt-expander-chevron.btn.small { min-width: var(--control-h); height: var(--control-h); padding: 0; justify-content: center; font-size: 17px; line-height: 1; }
    .prompt-expander-body textarea { width: 100%; min-height: 90px; resize: vertical; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--text); padding: 10px 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.45; outline: 0; }
    .prompt-expander-body textarea:focus, .prompt-expander-body .setting-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .prompt-expander-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .agent-text-field { display: flex; flex-direction: column; gap: 6px; }
    .agent-text-field-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .agent-text-field-head .setting-sub { display: block; margin-top: 2px; }
    .agent-text-field textarea { width: 100%; min-height: 90px; resize: vertical; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--text); padding: 10px 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.45; outline: 0; }
    .agent-text-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .agent-text-status { color: var(--muted); font-size: 12px; }
    .agent-text-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .codex-nudge-toast {
      position: absolute; top: 8px; right: 10px; z-index: 5;
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 8px; border-radius: 999px;
      background: var(--amber-soft-bg); color: var(--amber-soft-text);
      border: 1px solid var(--amber-soft-border);
      font-size: 11px; line-height: 1.2; font-weight: 600;
      pointer-events: none; user-select: none;
    }
    .codex-nudge-toast strong { font-size: 11px; }
    .codex-nudge-toast span { color: inherit; opacity: 0.8; }

    .app-tooltip { position: fixed; z-index: 1100; padding: 6px 10px; max-width: min(360px, calc(100vw - 16px)); background: var(--text-strong); color: var(--surface); border-radius: 7px; font-size: 11px; font-weight: 600; line-height: 1.3; box-shadow: 0 4px 12px oklch(0% 0 0 / .18); pointer-events: none; white-space: normal; overflow-wrap: anywhere; opacity: 0; transform: translateY(-2px); transition: opacity .12s ease, transform .12s ease; }
    .app-tooltip.app-tooltip-visible { opacity: 1; transform: translateY(0); }
    .app-tooltip[hidden] { display: none; }

    .terminal-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border-soft); }
    .terminal-toolbar > .terminal-toolbar-spacer { flex: 1; min-width: 8px; }
    .tui-prompts-popover { width: min(520px, calc(100vw - 32px)); max-height: min(70vh, 520px); overflow-y: auto; padding: 10px; }
    .tui-prompts-head { padding: 2px 4px 8px; color: var(--text-strong); font-size: 12px; font-weight: 800; }
    .tui-prompt-row { padding: 10px 0; border-top: 1px solid var(--border-soft); }
    .tui-prompt-row:first-of-type { border-top: 0; }
    .tui-prompt-row-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .tui-prompt-title { min-width: 0; color: var(--text-strong); font-family: var(--font-ui); font-size: 13px; font-weight: 850; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tui-prompt-insert.btn.small { flex: 0 0 auto; width: auto; min-width: 58px; height: var(--control-h); padding: 0 var(--control-px); justify-content: center; font-size: var(--control-fs); line-height: 1; }
    .tui-prompt-row textarea { width: 100%; min-height: 78px; resize: vertical; border: 1px solid var(--border); border-radius: 0; background: var(--field); color: var(--text); padding: 8px 10px; font-family: var(--font-mono); font-size: 12px; line-height: 1.45; outline: 0; }
    .terminal-toolbar .terminal-copy-status { color: var(--muted); font-size: 11px; }
    .terminal-toolbar .launch-split { z-index: 80; }
    .terminal-toolbar .launch-menu { z-index: 90; left: 0; right: auto; }
    .terminal.xterm-enabled .terminal-toolbar { background: var(--terminal-bar); border-bottom-color: var(--terminal-border); }
    .terminal.xterm-enabled .terminal-toolbar .btn.secondary, .terminal.xterm-enabled .terminal-toolbar .settings-dropdown-trigger, .terminal.xterm-enabled .terminal-toolbar .launch-arrow { background: transparent; color: #d4d4d4; border-color: var(--terminal-border); }
    .terminal.xterm-enabled .terminal-toolbar .btn.secondary:hover, .terminal.xterm-enabled .terminal-toolbar .settings-dropdown-trigger:hover, .terminal.xterm-enabled .terminal-toolbar .launch-arrow:hover { background: rgb(255 255 255 / .06); color: #fff; }
    .terminal.xterm-enabled .terminal-toolbar .terminal-copy-status { color: #9ca3af; }
    /* EP-002 WA-010: lay groups out side-by-side (2 cols) and clamp the popover height so a short viewport scrolls inside the popover instead of clipping below the window. */
    .tui-display-popover { padding: 12px; min-width: 240px; max-width: min(540px, calc(100vw - 24px)); max-height: min(70vh, 480px); overflow-y: auto; display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 12px 14px; }
    @media (max-width: 600px) { .tui-display-popover { grid-template-columns: minmax(180px, 1fr); max-width: calc(100vw - 24px); } }
    .tui-display-popover .tui-display-row { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .tui-display-popover .tui-display-row-label { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
    .tui-display-popover .segmented { gap: 6px; }
    .tui-display-popover .seg-option { padding: 5px 9px; font-size: 11px; }
    .line-height-segmented { gap: 8px; flex-wrap: wrap; }
    .line-height-option { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; }
    .line-height-option-text { display: inline-flex; flex-direction: column; gap: 0; line-height: 1.05; }
    .line-height-option-name { font-size: 12px; font-weight: 700; }
    .line-height-option-value { font-family: var(--font-mono); font-size: 10px; color: var(--muted); }
    .line-height-option.active .line-height-option-value { color: var(--accent-dark); }
    .line-height-option-preview { display: inline-block; padding: 2px 6px; border: 1px solid var(--border-soft); border-radius: 5px; background: var(--terminal); color: #d4d4d4; min-width: 24px; text-align: center; }
    .tui-display-popover .line-height-option { padding: 4px 8px; }
    .tui-display-popover .line-height-option-name { font-size: 11px; }
    .tui-display-popover .line-height-option-preview { padding: 1px 5px; font-size: 10px; }

    .notification-icon-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; }
    .notification-badge { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; line-height: 1; }
    .notification-badge[hidden] { display: none; }
    :root[data-sidebar="collapsed"] .notification-badge { min-width: 8px; height: 8px; padding: 0; font-size: 0; top: -2px; right: -2px; }
    .nav-message-indicator { margin-left: auto; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 10px; font-weight: 900; line-height: 18px; text-align: center; box-shadow: 0 0 0 2px var(--surface); }
    .nav-message-indicator[hidden] { display: none; }
    :root[data-sidebar="collapsed"] .nav-message-indicator { position: absolute; top: 6px; right: 6px; min-width: 8px; width: 8px; height: 8px; padding: 0; font-size: 0; line-height: 8px; box-shadow: 0 0 0 2px var(--surface); }
    .messages-new-marker-pill { position: sticky; bottom: 12px; z-index: 12; display: flex; align-items: center; justify-content: center; min-height: 34px; margin: 12px 16px 0 auto; padding: 0 14px; border: 0; border-radius: 999px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 900; box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 28%, transparent); cursor: pointer; }
    .messages-new-marker-pill:hover { background: var(--accent-dark); }
    .notification-pill-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 999px; background: var(--field); color: var(--text); font-size: var(--control-fs); font-weight: 800; }
    .notification-pill-toggle.on { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .notification-pill-track { position: relative; width: 28px; height: 16px; border-radius: 999px; background: color-mix(in srgb, var(--muted) 28%, transparent); }
    .notification-pill-toggle.on .notification-pill-track { background: var(--accent); }
    .notification-pill-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .12s ease; }
    .notification-pill-toggle.on .notification-pill-knob { transform: translateX(12px); }
    .notification-pill-state { min-width: 18px; text-align: left; }
    .notification-clear-modal { width: min(440px, 100%); }
    .notification-settings-heading { margin: 18px 0 8px; color: var(--text-strong); font-size: 12px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
    .notification-status-value { color: var(--text); font-size: 13px; }
    .notification-event-list { border-top: 1px solid var(--border-soft); }
    .notification-event-row { display: grid; grid-template-columns: minmax(210px, .42fr) minmax(260px, .58fr); gap: 4px 20px; align-items: center; position: relative; z-index: 0; border-bottom: 1px solid var(--border-soft); }
    .notification-event-header { padding: 8px 0; color: var(--muted); font-size: 11px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
    .notification-event-name, .notification-channel-control { min-height: 58px; padding: 10px 0; }
    .notification-event-name { display: flex; flex-direction: column; gap: 3px; }
    .notification-event-controls { display: grid; grid-template-columns: 88px 88px minmax(150px, 170px); column-gap: 12px; align-items: center; justify-content: start; position: relative; z-index: 0; }
    .notification-channel-control { display: flex; align-items: center; justify-content: flex-start; }
    .notification-sound-dropdown { min-width: 150px; }
    .notification-event-row:has(.notification-sound-dropdown.open), .notification-event-controls:has(.notification-sound-dropdown.open) { z-index: 45; }
    .notification-event-list .notification-sound-dropdown.open { position: relative; z-index: 45; }
    .notification-event-list .notification-sound-dropdown.open .launch-menu { z-index: 46; }
    @media (max-width: 760px) {
      .notification-event-row { grid-template-columns: 1fr; gap: 0; }
      .notification-event-header-row { display: none; }
      .notification-event-name { border-bottom: 0; padding-bottom: 4px; }
      .notification-event-controls { grid-template-columns: minmax(82px, auto) minmax(82px, auto) minmax(150px, 1fr); column-gap: 8px; }
      .notification-channel-control { min-height: auto; padding: 5px 0; }
    }

    .notification-popover { position: fixed; z-index: 50; width: 360px; max-height: 60vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18); overflow: hidden; }
    .notification-popover.hidden, .notification-popover[hidden] { display: none; }
    .notification-popover-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-soft); }
    .notification-popover-header h3 { flex: 1; margin: 0; font-size: 13px; font-weight: 700; }
    .notification-popover-mute-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border-soft); font-size: 12px; }
    .notification-popover-mute-row .notification-mute-label { flex: 1; }
    .notification-popover-list { flex: 1; overflow-y: auto; padding: 4px 0; }
    .notification-entry { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-bottom: 1px solid var(--border-soft); cursor: pointer; }
    .notification-entry:hover { background: var(--surface-hover); }
    .notification-entry.unread { border-left: 3px solid var(--accent); padding-left: 9px; }
    .notification-entry-meta { display: flex; gap: 8px; font-size: 11px; color: var(--muted); }
    .notification-entry-title { font-size: 12px; font-weight: 600; color: var(--text-strong); }
    .notification-entry-body { font-size: 12px; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .notification-popover-empty { padding: 24px 12px; text-align: center; color: var(--muted); font-size: 12px; }
    .notification-popover-footer { display: flex; padding: 8px 12px; border-top: 1px solid var(--border-soft); }
    .notification-popover-footer button { font-size: 12px; }

    .notification-toast-stack { position: fixed; bottom: 16px; left: calc(var(--sidebar-width, 220px) + 12px); z-index: 40; display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none; }
    :root[data-sidebar="collapsed"] .notification-toast-stack { left: calc(64px + 12px); }
    .notification-toast { pointer-events: auto; max-width: 380px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .app-toast-error { border-color: var(--red-soft-border); background: var(--red-soft-bg); }
    .app-toast-error .notification-toast-title, .app-toast-error .notification-toast-body { color: var(--red-text); }
    .notification-toast-title { font-weight: 600; color: var(--text-strong); }
    .notification-toast-body { color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .notification-toast-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px; }
    .notification-toast-action { font-size: 11px; padding: 2px 6px; }

    @media (max-width: 760px) {
      .app { flex-direction: row; min-height: 100dvh; }
      .mobile-sidebar-tab { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 52px; min-width: 52px; padding: 0; border-right: 1px solid var(--border); }
      .mobile-sidebar-tab .brand-logo { width: 24px; height: 24px; }
      .mobile-sidebar-backdrop { display: block; position: fixed; inset: 0; z-index: 900; background: rgb(15 23 42 / .45); opacity: 0; pointer-events: none; transition: opacity .16s ease; }
      /* Higher-specificity selectors than the base [data-sidebar] width rules
         in shell-styles.ts (180px expanded / 64px collapsed) so the mobile
         sidebar genuinely fills the viewport when open, not 25-30%. */
      :root .sidebar,
      :root[data-sidebar="collapsed"] .sidebar,
      :root[data-sidebar="expanded"] .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 910; width: 100vw; max-width: 100vw; transform: translateX(-102%); overflow-y: auto; overscroll-behavior: contain; transition: transform .18s ease; box-shadow: none; }
      :root[data-mobile-sidebar="open"] .mobile-sidebar-backdrop { opacity: 1; pointer-events: auto; }
      :root[data-mobile-sidebar="open"] .sidebar { transform: translateX(0); }
      :root[data-mobile-sidebar="open"] .brand { justify-content: flex-start; gap: 10px; padding: 14px 16px; }
      :root[data-mobile-sidebar="open"] .brand-text, :root[data-mobile-sidebar="open"] .workspace-switcher-copy, :root[data-mobile-sidebar="open"] .workspace-caret, :root[data-mobile-sidebar="open"] .nav-label, :root[data-mobile-sidebar="open"] .sidebar-action-label, :root[data-mobile-sidebar="open"] .footer-main { display: block; }
      :root[data-mobile-sidebar="open"] .workspace-switcher { display: block; margin: 8px 10px; }
      :root[data-mobile-sidebar="open"] .workspace-switcher-trigger { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; justify-content: stretch; padding: 8px 10px; }
      :root[data-mobile-sidebar="open"] .workspace-menu { left: 0; right: 0; top: calc(100% + 6px); width: auto; }
      :root[data-mobile-sidebar="open"][data-sidebar="collapsed"] .nav a { justify-content: flex-start; gap: 10px; padding: 9px 12px; }
      :root[data-mobile-sidebar="open"][data-sidebar="collapsed"] .sidebar-actions { padding: 10px 8px; }
      :root[data-mobile-sidebar="open"][data-sidebar="collapsed"] .sidebar-action { justify-content: flex-start; gap: 10px; padding: 9px 12px; }
      .shell { width: 100%; min-width: 0; min-height: 0; flex: 1 1 auto; }
      .content { min-height: 0; }
    }

    .workspace-edit-modal .field-input { width: 100%; min-height: var(--control-h); margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); padding: 0 var(--control-px); font: inherit; font-size: var(--control-fs); outline: 0; }
    .workspace-edit-modal .field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
    .workspace-edit-modal .field-readonly { padding: 9px 10px; margin-bottom: 12px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); color: var(--muted); font-size: 13px; word-break: break-all; }
    .workspace-edit-modal .segmented { display: inline-flex; gap: 6px; margin-bottom: 12px; }
    .workspace-edit-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-soft); }
    .workspace-edit-section:first-of-type { margin-top: 10px; }
    .workspace-edit-section h3 { margin: 0 0 10px; color: var(--text-strong); font-size: 13px; font-weight: 850; }
    .workspace-edit-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .workspace-edit-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 10px; border: 1px solid var(--border-soft); border-radius: 10px; background: var(--surface-soft); }
    .workspace-edit-row-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; color: var(--text); font-size: 12px; }
    .workspace-edit-row-main .field-input { margin-bottom: 0; }
    .workspace-edit-row-main .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; }
    .workspace-edit-row-main small { color: var(--muted); font-size: 11px; }
    .workspace-edit-row-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .workspace-edit-empty { padding: 10px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); font-size: 12px; text-align: center; }
    .agent-operator-checkbox-label { display: inline-flex; align-items: center; gap: 8px; margin: 8px 0 2px; font: 600 12px var(--font-ui); color: var(--text-strong); cursor: pointer; user-select: none; }
    .agent-operator-checkbox-label input[type="checkbox"] { accent-color: var(--accent); }
    .agent-operator-checkbox-help { font-size: 11px; color: var(--muted); margin-bottom: 8px; max-width: 56ch; }
    .agent-edit-roles { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; max-height: 150px; overflow-y: auto; padding: 6px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); }
    .agent-edit-roles .agent-role-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); font-family: var(--font-mono); font-size: 11px; font-weight: 700; cursor: pointer; user-select: none; }
    .agent-edit-roles .agent-role-chip:hover { background: var(--surface-hover); }
    .agent-edit-roles .agent-role-chip.selected { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .agent-edit-roles .agent-role-chip .agent-role-builtin { font: 500 9.5px var(--font-ui); padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--muted) 14%, transparent); color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
    .agent-edit-roles .agent-role-chip.selected .agent-role-builtin { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent-dark); }
    .agent-edit-roles-empty { color: var(--muted); font-size: 11px; padding: 6px 4px; }
    .agent-edit-roles-help { margin: 0 0 12px; color: var(--muted); font-size: 11px; line-height: 1.4; font-weight: 500; }

    /* RBAC Phase 3 slice 6 — Audit subtab. Palette is intentionally NOT
       pure RAG: expected pill is blue (informational rule, not a status),
       has-exact green, has-close yellow (wrong-scope match), has-none red. */
    .audit-tab-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 5px; background: var(--red-soft-bg); color: var(--red-text); font: 700 10.5px var(--font-mono); border: 1px solid var(--red-soft-border); }
    .audit-page { display: flex; flex-direction: column; min-height: 0; }
    .audit-admin-toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 0 0; }
    .audit-admin-toolbar .audit-admin-toolbar-hint { font-size: 11px; color: var(--muted); }
    .audit-summary-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--border-soft); }
    .audit-summary-card { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); min-width: 180px; }
    .audit-summary-card.warn { border-color: var(--red-soft-border); background: var(--red-soft-bg); color: var(--red-text); }
    .audit-summary-card .num { font-family: var(--font-mono); font-size: 18px; font-weight: 800; color: var(--text-strong); }
    .audit-summary-card.warn .num { color: var(--red-text); }
    .audit-summary-card .lbl { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .audit-summary-card.warn .lbl { color: var(--red-text); }
    .audit-summary-card .num-suffix { color: var(--muted); font-size: 10px; margin-left: 4px; }
    .audit-filter-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border-soft); }
    .audit-filter-row .filter-label { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-right: 4px; }
    .audit-filter-row .filter-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 12px; font-weight: 700; cursor: pointer; }
    .audit-filter-row .filter-pill:hover { background: var(--surface-hover); color: var(--text); }
    .audit-filter-row .filter-pill.active { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .audit-filter-row .filter-spacer { flex: 1 1 auto; }
    .audit-filter-row .filter-clear { color: var(--muted); font-size: 11px; font-weight: 700; background: transparent; border: 0; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
    .audit-filter-row .filter-clear:hover { color: var(--text); background: var(--surface-hover); }
    .audit-list { padding: 14px 0 0; min-height: 0; overflow: auto; }
    .audit-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); overflow: hidden; }
    .audit-table thead th { text-align: left; padding: 10px 12px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); background: var(--surface-soft); border-bottom: 1px solid var(--border); white-space: nowrap; }
    .audit-table tbody td { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
    .audit-table tbody tr:last-child td { border-bottom: 0; }
    .audit-table tbody tr.audit-row:hover { background: var(--surface-hover); }
    .audit-row.miss td:first-child { box-shadow: inset 3px 0 0 var(--red); }
    .audit-table .ts-cell { font-family: var(--font-mono); font-size: 11px; color: var(--muted); white-space: nowrap; }
    .audit-table .ts-cell strong { color: var(--text-strong); display: block; font-weight: 700; }
    .audit-table .actor-cell { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: var(--text-strong); white-space: nowrap; }
    .audit-table .actor-roles { display: block; margin-top: 3px; color: var(--muted); font-size: 10.5px; font-weight: 600; font-family: var(--font-ui); letter-spacing: 0; }
    .audit-table .tool-cell { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: var(--text-strong); }
    .audit-table .grant-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .audit-table .grant-pill { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 5px; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; align-self: flex-start; }
    .audit-table .grant-pill .lbl { font-family: var(--font-ui); font-weight: 700; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; opacity: .8; }
    .audit-table .grant-pill.expected { background: oklch(96% 0.04 240); color: oklch(40% 0.18 240); border: 1px solid oklch(85% 0.08 240); }
    .audit-table .grant-pill.has-exact { background: color-mix(in srgb, var(--green) 12%, var(--surface)); color: oklch(38% 0.14 150); border: 1px solid color-mix(in srgb, var(--green) 28%, var(--border)); }
    .audit-table .grant-pill.has-close { background: oklch(96% 0.06 95); color: oklch(40% 0.14 95); border: 1px solid oklch(85% 0.13 95); }
    .audit-table .grant-pill.has-none { background: var(--red-soft-bg); color: var(--red-text); border: 1px solid var(--red-soft-border); }
    .audit-table .target-cell { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
    .audit-table .target-cell strong { color: var(--text-strong); }
    .audit-table .kind-cell { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 5px; background: var(--red-soft-bg); color: var(--red-text); border: 1px solid var(--red-soft-border); white-space: nowrap; cursor: help; display: inline-block; }
    .audit-table .kind-cell.pass { background: color-mix(in srgb, var(--green) 12%, var(--surface)); color: oklch(38% 0.14 150); border-color: color-mix(in srgb, var(--green) 28%, var(--border)); }
    .audit-row-detail td { padding: 0 !important; }
    .audit-row-detail .detail-body { padding: 12px 16px 14px; background: var(--surface-soft); border-bottom: 1px solid var(--border-soft); display: grid; grid-template-columns: minmax(180px, 220px) 1fr; gap: 10px 18px; font-size: 11.5px; }
    .audit-row-detail .detail-key { color: var(--muted); font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .audit-row-detail .detail-val { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-strong); word-break: break-word; }
    .audit-row-detail pre { margin: 0; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 8px; font: 11px var(--font-mono); color: var(--text); white-space: pre-wrap; }
    .audit-empty { padding: 60px 24px; text-align: center; color: var(--muted); font-size: 13px; }
    .audit-empty strong { display: block; color: var(--text-strong); font-size: 14px; margin-bottom: 4px; }
    .audit-pagination { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 0; border-top: 1px solid var(--border-soft); margin-top: 14px; }
    .audit-pagination .pag-info { color: var(--muted); font-size: 11.5px; font-weight: 700; }
    .audit-pagination .pag-info strong { color: var(--text-strong); font-family: var(--font-mono); }
    .audit-pagination .pag-buttons { display: inline-flex; gap: 6px; }
    @media (max-width: 920px) {
      .audit-table thead th.col-target, .audit-table tbody td.col-target { display: none; }
    }
    @media (max-width: 720px) {
      .audit-table thead th.col-actor-roles, .audit-table tbody td.col-actor-roles { display: none; }
      .audit-summary-card { min-width: 0; flex: 1 1 calc(50% - 5px); }
    }
    .workspace-edit-badge { align-self: flex-start; padding: 2px 6px; border-radius: 999px; background: color-mix(in srgb, var(--red) 10%, var(--surface)); color: var(--red); font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .checkbox-row { display: inline-flex; align-items: center; gap: 7px; color: var(--text); font-size: 12px; }
    @media (max-width: 760px) { .workspace-edit-row { grid-template-columns: minmax(0, 1fr); } .workspace-edit-row-actions { justify-content: flex-start; } }
    .settings-dropdown-host { display: block; margin-bottom: 12px; }
    .settings-dropdown-host .settings-dropdown { width: 100%; }
    .settings-dropdown-host .settings-dropdown-trigger { width: 100%; justify-content: flex-start; }

    .workspace-card { position: relative; padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: 0 1px 2px rgb(15 23 42 / .04); }
    .workspace-card + .workspace-card { margin-top: 10px; }
    .workspace-card-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
    .workspace-card-title { margin: 0; color: var(--text-strong); font-size: 16px; font-weight: 900; letter-spacing: 0; }
    .workspace-card-current { margin-left: 8px; padding: 1px 6px; border-radius: 9999px; background: var(--accent-light); color: var(--accent-dark); font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .workspace-card-path { margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
    .workspace-card-actions { display: flex; gap: 6px; align-items: center; }
    .workspace-card-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
    .workspace-card-icon-btn:hover, .workspace-card-icon-btn:focus-visible { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); outline: 0; }
    .workspace-card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; color: var(--muted); font-size: 12px; }
    .workspace-card-tags span { padding: 4px 8px; border: 1px solid var(--border-soft); border-radius: 7px; background: var(--surface-soft); }
    .workspace-card-menu { position: absolute; right: 16px; top: 56px; z-index: 80; min-width: 160px; padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 18px 40px rgb(15 23 42 / .18); }
    .workspace-card-menu.hidden { display: none; }
    .workspace-card-menu button { width: 100%; display: block; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; font-size: 12px; font-weight: 700; cursor: pointer; }
    .workspace-card-menu button:hover, .workspace-card-menu button:focus-visible { background: var(--accent-light); color: var(--accent-dark); outline: 0; }
    .workspace-card-menu button.danger { color: var(--red); }
    .workspace-card-menu button.danger:hover, .workspace-card-menu button.danger:focus-visible { background: color-mix(in srgb, var(--red) 12%, var(--surface)); color: var(--red); }
    .workspace-trash-meta { margin-top: 4px; color: var(--muted); font-size: 11px; }
    .workspaces-overview-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-soft); color: var(--muted); font-size: 12px; }

    .agent-card { padding: 14px 16px; }
    .agent-card.missing { border-color: color-mix(in srgb, var(--red) 36%, var(--border)); background: color-mix(in srgb, var(--red) 5%, var(--surface)); }
    .agent-card-id { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
    .agent-card-id > div { min-width: 0; }
    .agent-card-id .workspace-card-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .agent-card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--muted); font-size: 11px; line-height: 1.35; margin-top: 4px; }
    .agent-card-rbac-chips { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .agent-card-roles-empty { color: var(--muted); }
    .agent-card-summary { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; }
    .agent-stale-runner-banner { margin-top: 10px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--amber) 38%, var(--border)); border-radius: 9px; background: color-mix(in srgb, var(--amber) 10%, var(--surface)); color: var(--text-strong); font-size: 12px; font-weight: 800; }
    .agent-card-actions { gap: 6px; align-items: center; }
    .agent-card-actions .launch-split { z-index: 1; }
    .agent-card-actions .launch-split:has(.launch-menu) { z-index: 90; }
    .agent-card-overflow { width: var(--control-h); height: var(--control-h); }
    .agent-card-menu { right: 16px; top: 56px; }
    .sidebar-action.hidden { display: none; }

    /* Agents overview: edge-to-edge layout (no L/R padding) — matches the Kanban table look. Scoped to agents page so workspaces overview keeps its padding. */
    .agent-page .agent-overview { padding: 0 !important; }
    .agents-overview-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: var(--surface); }
    .agents-overview-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .agents-overview-header-right { display: flex; align-items: center; gap: 8px; }
    .agents-overview-header-right .btn.small { height: var(--control-h); padding: 0 14px; border-radius: 8px; }
    .agents-overview-overflow { position: relative; }
    .agents-overview-menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 220px; }

    .repo-group-collapse { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; transition: transform .12s ease; }
    .repo-group-collapse:hover, .repo-group-collapse:focus-visible { color: var(--text-strong); outline: 0; }
    .repo-group.collapsed .repo-group-collapse { transform: rotate(-90deg); }
    .repo-group.collapsed .agent-row-list { display: none; }

    .repo-group-id { display: flex; align-items: center; min-width: 0; gap: 8px; }
    .repo-group-id-text { display: inline-flex; flex-wrap: wrap; align-items: baseline; min-width: 0; gap: 8px; }
    .repo-group-id-text span { color: var(--text-strong); font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .repo-group-id-sep { color: var(--muted); font-size: 12px; font-weight: 700; }
    .repo-group-id-text .mono { color: var(--muted); font-size: 11px; font-weight: 600; text-transform: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-group-actions { display: flex; align-items: center; gap: 8px; }
    .repo-group-overflow { position: relative; }
    .repo-group-overflow .workspace-card-icon-btn { width: var(--control-h); height: var(--control-h); font-size: 14px; }
    .repo-group-menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 200px; }
    .repo-group-actions .btn.small { height: var(--control-h); padding: 0 14px; border-radius: 8px; }

    /* Indent the agent-card list so cards don't touch the page edges. Empty pill aligns with cards. */
    .repo-group .agent-row-list { padding: 8px 14px; gap: 8px; }
    .repo-empty-pill { padding: 12px 14px; color: var(--muted); font-size: 12px; }

    /* Sweep: every action button in an agent row is 32px tall (matches the [⋯] icon button). */
    .agent-card-actions .icon-btn { height: var(--control-h); min-width: var(--control-h); padding: 0 var(--control-px); display: inline-flex; align-items: center; justify-content: center; }
    .agent-card-actions .launch-arrow { height: var(--control-h); }
    .agent-card-actions .launch-split .icon-btn { border-radius: 8px 0 0 8px; }
    .agent-card-actions .launch-split .launch-arrow { border-radius: 0 8px 8px 0; }
    .agent-card-actions .workspace-card-icon-btn { width: var(--control-h); height: var(--control-h); }

    .agents-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 320px; padding: 40px; color: var(--muted); }
    .agents-empty-title { color: var(--text); font-size: 15px; font-weight: 700; }

    .agent-config-page { max-width: 980px; margin: 0 auto; padding: 18px 18px 88px; }
    .agent-config-crumbs { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; color: var(--muted); font-size: 12px; }
    .agent-config-head { display: flex; align-items: center; gap: 14px; margin: 0 0 16px; }
    .agent-config-head .role-avatar { flex: 0 0 auto; }
    .agent-config-head-copy { min-width: 0; flex: 1 1 auto; }
    .agent-config-head-copy h1 { margin: 0; color: var(--text-strong); font-size: 20px; line-height: 1.15; }
    .agent-config-head-copy p, .agent-config-kicker { margin: 3px 0 0; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
    .agent-config-head-actions { flex: 0 0 auto; }
    .agent-config-section { margin-bottom: 14px; padding: 16px; }
    .agent-config-persona-placeholder .thread-empty { margin: 0; }
    .agent-config-page .settings-save-bar { position: sticky; bottom: 0; z-index: 15; margin: 18px -18px -88px; padding: 12px 18px; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(8px); }
    .agent-config-page .workspace-add-status { margin-top: 10px; color: var(--muted); font-size: 12px; }
    .agent-config-page .workspace-add-status.error { color: var(--red); }
    @media (max-width: 760px) { .agent-config-page { padding-inline: 12px; } .agent-config-head { align-items: flex-start; } .agent-config-head-actions { margin-left: auto; } }

    .agent-avatar-identicon { display: inline-flex; }
    .agent-avatar-identicon .agent-identicon { display: block; border-radius: 6px; border: 1px solid var(--border); overflow: hidden; }

    /* Runtime pills used in Add/Edit Agent dialogs. */
    .runtime-pill-group { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .runtime-pill { padding: 8px 14px; border-radius: 999px; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font-size: 12px; font-weight: 700; cursor: pointer; }
    .runtime-pill:hover, .runtime-pill:focus-visible { border-color: var(--accent); color: var(--accent-dark); outline: 0; }
    .runtime-pill.active { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent); }

    /* Compact icon-only action buttons (▶ launch / ■ stop). */
    .icon-btn { padding: 6px 10px; min-width: 32px; }
    .icon-btn .agent-action-icon { display: block; }
    .agent-stop-btn { background: var(--red); color: #fff; box-shadow: 0 2px 8px color-mix(in srgb, var(--red) 28%, transparent); }
    .agent-stop-btn:hover, .agent-stop-btn:focus-visible { background: color-mix(in srgb, var(--red) 78%, black 22%); color: #fff; }

    /* RBAC Phase 2b — Settings → Roles tab. Class hooks mirror docs/mockups/settings-roles.html. */
    .rbac-roles-settings .roles-action-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0 12px; }
    .rbac-roles-settings .roles-scope-badge { display: inline-block; margin-left: 8px; padding: 2px 8px; border: 1px solid var(--border-soft); border-radius: 999px; background: var(--surface-soft); color: var(--muted); font-size: 11px; font-weight: 600; vertical-align: middle; }
    .rbac-roles-settings .rbac-mode-row { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); }
    .rbac-roles-settings .rbac-mode-label { color: var(--muted); font-size: 12px; font-weight: 700; margin-right: 4px; }
    .rbac-roles-settings .rbac-mode-row .rbac-mode-option { padding: 6px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--field); color: var(--text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: background .12s, border-color .12s; }
    .rbac-roles-settings .rbac-mode-row .rbac-mode-option:hover, .rbac-roles-settings .rbac-mode-row .rbac-mode-option:focus-visible { border-color: var(--accent); outline: 0; }
    .rbac-roles-settings .rbac-mode-row .rbac-mode-option.selected { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); }
    .rbac-audit-off-banner { margin-bottom: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--accent) 8%, var(--surface)); color: var(--text-strong); font-size: 13px; font-weight: 600; }
    .rbac-roles-settings .roles-counts { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
    .rbac-roles-settings .roles-counts strong { color: var(--text-strong); font-weight: 800; }
    .rbac-roles-settings .roles-counts .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--border); }
    .rbac-roles-settings .role-list { display: flex; flex-direction: column; gap: 8px; }
    /* All Phase 2b/2c .role-* selectors are scoped under .rbac-roles-settings
       so they don't pollute the agent-overview page's .role-row / .role-name
       / .role-summary / .role-actions classes from shell-styles.ts. The base
       .role-row { display: flex } there is intentional for the agent card
       row; this scoped override only flips display:block inside the RBAC
       Settings tab so header + body stack vertically. */
    .rbac-roles-settings .role-row { display: block; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; gap: 0; align-items: stretch; }
    .rbac-roles-settings .role-row.expanded { box-shadow: 0 1px 3px color-mix(in srgb, var(--accent) 10%, transparent); }
    .rbac-roles-settings .role-row-header { display: grid; grid-template-columns: 36px auto minmax(0, 1fr) auto auto; align-items: center; gap: 12px; width: 100%; padding: 10px 14px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .rbac-roles-settings .role-row-header:hover { background: var(--surface-hover); }
    .rbac-roles-settings .role-row.expanded .role-row-header { border-bottom: 1px solid var(--border-soft); }
    .rbac-roles-settings .role-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 9px; background: var(--accent-light); color: var(--accent-dark); font-family: var(--font-mono); font-size: 13px; font-weight: 800; }
    .rbac-roles-settings .role-name-cell { display: inline-flex; flex-direction: column; gap: 3px; min-width: 0; max-width: min(240px, 28vw); }
    .rbac-roles-settings .role-name { font-family: var(--font-mono); font-size: 13px; font-weight: 800; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rbac-roles-settings .role-builtin, .rbac-roles-settings .role-custom-chip { display: inline-flex; align-items: center; width: max-content; min-height: var(--control-h-sm); gap: 4px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--border-soft); background: var(--surface-soft); color: var(--muted); font-size: 10.5px; font-weight: 700; }
    .rbac-roles-settings .role-builtin .lock-glyph { font-size: 9px; }
    .rbac-roles-settings .role-desc { color: var(--muted); font-size: 12px; line-height: 1.45; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rbac-roles-settings .role-desc-empty { font-style: italic; color: var(--border); }
    .rbac-roles-settings .role-summary { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
    .rbac-roles-settings .role-summary .pip { width: 3px; height: 3px; border-radius: 50%; background: var(--border); }
    .rbac-roles-settings .role-summary strong { color: var(--text-strong); font-weight: 800; }
    .rbac-roles-settings .role-chevron { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 8px; color: var(--muted); font-size: 11px; }
    .rbac-roles-settings .role-row.expanded .role-chevron { color: var(--accent-dark); background: var(--accent-light); }
    .rbac-roles-settings .role-row-body { display: flex; flex-direction: column; gap: 14px; padding: 14px; background: var(--surface-soft); }
    .rbac-roles-settings .role-field-row { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 14px; }
    .rbac-roles-settings .role-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .rbac-roles-settings .role-field label { color: var(--text-strong); font-size: 11.5px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; }
    .rbac-roles-settings .role-field input, .rbac-roles-settings .role-field textarea { width: 100%; min-height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); font-family: var(--font-mono); font-size: var(--control-fs); font-weight: 500; line-height: 1.5; outline: 0; }
    .rbac-roles-settings .role-field input:focus, .rbac-roles-settings .role-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent); }
    .rbac-roles-settings .role-field input[readonly] { background: var(--surface-muted); color: var(--muted); cursor: not-allowed; }
    .rbac-roles-settings .role-field textarea { font-family: var(--font-ui); font-size: 13px; resize: vertical; }
    .rbac-roles-settings .role-field-help { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .rbac-roles-settings .role-row-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 8px; border-top: 1px solid var(--border-soft); }
    .rbac-roles-settings .role-row-footer .role-meta { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 11px; }
    .rbac-roles-settings .role-row-footer .role-meta code { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 4px; padding: 1px 5px; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-strong); }
    .rbac-roles-settings .role-row-footer .role-actions { display: inline-flex; gap: 8px; }
    .rbac-roles-settings .role-row-footer .role-save-status { display: inline-flex; align-items: center; flex: 1 1 auto; min-width: 0; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; line-height: 1.4; }
    .rbac-roles-settings .role-row-footer .role-save-status-ok { color: oklch(38% 0.14 150); background: oklch(95% 0.04 150); border: 1px solid oklch(86% 0.07 150); }
    .rbac-roles-settings .role-row-footer .role-save-status-err { color: var(--red-text); background: var(--red-soft-bg); border: 1px solid var(--red-soft-border); }
    @media (max-width: 760px) {
      .rbac-roles-settings .role-field-row { grid-template-columns: 1fr; }
      /* Switch the header from grid to flex on mobile — the grid mode mixed
         hidden columns awkwardly when description/summary collapsed away on
         narrow viewports, leaving an empty left half on the expanded card.
         Flex lays out the visible icon + name-cell + chevron cleanly. */
      .rbac-roles-settings .role-row-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; grid-template-columns: none; }
      .rbac-roles-settings .role-name-cell { flex: 1 1 auto; min-width: 0; }
      .rbac-roles-settings .role-desc, .rbac-roles-settings .role-summary { display: none; }
      .rbac-roles-settings .role-row-body { padding: 12px; }
      /* The chip-list auto-fill minmax(280px) used to overflow narrow phones
         (~360px viewport minus body padding < 280px), forcing horizontal
         scroll. Single-column is the right call below 480px. */
      .rbac-roles-settings .grant-chip-list { grid-template-columns: 1fr; }
    }

    .rbac-roles-settings .role-grants { display: flex; flex-direction: column; gap: 12px; }
    /* Per-mockup tabbar so the user picks one grant category at a time
       inside an expanded role row, instead of stacking every category
       vertically. */
    .rbac-roles-settings .grant-category-tabbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border: 1px solid var(--border-soft); border-radius: 10px; background: var(--surface-soft); }
    .rbac-roles-settings .grant-category-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 7px; background: transparent; color: var(--muted); font-size: 11.5px; font-weight: 700; cursor: pointer; border: 0; }
    .rbac-roles-settings .grant-category-tab:hover { background: var(--surface-hover); color: var(--text); }
    .rbac-roles-settings .grant-category-tab.active { background: var(--accent-light); color: var(--accent-dark); }
    .rbac-roles-settings .grant-category-tab .gc-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--surface); color: var(--muted); font-family: var(--font-mono); font-size: 10px; font-weight: 800; border: 1px solid var(--border-soft); }
    .rbac-roles-settings .grant-category-tab.active .gc-count { background: var(--accent); color: #fff; border-color: var(--accent); }
    .rbac-roles-settings .grant-category-body { display: flex; flex-direction: column; gap: 14px; }
    .grant-category { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border-soft); border-radius: 10px; background: var(--surface); }
    .grant-category-head { display: flex; align-items: center; justify-content: space-between; }
    .grant-category-head h4 { margin: 0; color: var(--text-strong); font-family: var(--font-ui); font-size: 13px; font-weight: 800; letter-spacing: -.005em; }
    .grant-category-count { display: inline-flex; align-items: baseline; gap: 2px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .grant-category-count strong { color: var(--text-strong); font-size: 12px; font-weight: 900; }
    .grant-category-hint { margin: 0; color: var(--muted); font-size: 11.5px; line-height: 1.45; }
    .grant-chip-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
    .grant-chip { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); cursor: pointer; user-select: none; transition: background .12s, border-color .12s; }
    .grant-chip:hover { background: var(--surface-hover); }
    .grant-chip-input { position: absolute; inset: 0; opacity: 0; pointer-events: none; margin: 0; }
    .grant-chip .gc-mark { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; height: 16px; margin-top: 2px; border-radius: 4px; border: 1px solid var(--border); background: var(--field); color: transparent; font-size: 11px; font-weight: 900; }
    .grant-chip-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .grant-chip-id { font-family: var(--font-mono); font-size: 11.5px; font-weight: 800; color: var(--text-strong); letter-spacing: -.005em; word-break: break-all; }
    .grant-chip-desc { color: var(--muted); font-size: 11px; line-height: 1.4; font-weight: 500; }
    .grant-chip.checked { border-color: var(--accent); background: var(--accent-light); }
    .grant-chip.checked .gc-mark { border-color: var(--accent); background: var(--accent); color: #fff; }
    .grant-chip.checked .grant-chip-id { color: var(--accent-dark); }
    .grant-chip.checked .grant-chip-desc { color: color-mix(in srgb, var(--accent-dark) 75%, var(--muted)); }
    .grant-chip-readonly { cursor: not-allowed; opacity: .85; }
    .grant-category-readonly { background: var(--surface-soft); }

    .grant-action-list { display: flex; flex-direction: column; gap: 6px; }
    .grant-action-row { display: grid; grid-template-columns: minmax(220px, 1.4fr) minmax(0, 2fr); gap: 12px; align-items: center; padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--surface-soft); transition: background .12s, border-color .12s; }
    .grant-action-row.checked { border-color: var(--accent); background: var(--accent-light); }
    .grant-action-head { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .grant-action-name { font-family: var(--font-mono); font-size: 12px; font-weight: 800; color: var(--text-strong); }
    .grant-action-desc { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .grant-action-row.checked .grant-action-name { color: var(--accent-dark); }
    .grant-action-scopes { display: inline-flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .grant-scope-chip { padding: 4px 8px; align-items: center; gap: 6px; }
    .grant-scope-chip .grant-chip-id { font-size: 11px; word-break: normal; }
    .grant-scope-chip .gc-mark { width: 14px; height: 14px; margin-top: 0; font-size: 10px; }
    @media (max-width: 760px) {
      .grant-action-row { grid-template-columns: 1fr; }
      .grant-action-scopes { justify-content: flex-start; }
    }

    .rbac-roles-settings .role-delete-btn { color: var(--red-text); }
    .rbac-roles-settings .role-delete-btn:hover, .rbac-roles-settings .role-delete-btn:focus-visible { background: var(--red-soft-bg); border-color: var(--red-soft-border); }
    .rbac-add-role-modal { width: min(520px, calc(100vw - 32px)); }
    .rbac-add-role-modal .field-input { width: 100%; min-height: var(--control-h); margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); padding: 0 var(--control-px); font: inherit; font-size: var(--control-fs); outline: 0; }
    .rbac-add-role-modal .field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
    .rbac-add-role-modal .rbac-modal-help { display: block; margin: -6px 0 14px; color: var(--muted); font-family: var(--font-ui); font-size: 11.5px; line-height: 1.4; font-weight: 500; }
    .rbac-add-role-modal .rbac-modal-name { font-family: var(--font-mono); font-size: 13px; }
    .rbac-add-role-modal .rbac-modal-desc { min-height: 110px; resize: vertical; font-family: var(--font-ui); font-size: 13px; line-height: 1.45; }

    /* Inner sub-tabbar inside the Roles section: list view vs matrix view. */
    .roles-inner-tabbar { margin-bottom: 12px; min-height: 40px; border-radius: 10px; }
    .roles-inner-tabbar .term-tab { height: 40px; padding: 0 14px; }

    /* Permissions Overview matrix. Wrapped for horizontal scroll on narrow
       viewports — the matrix density doesn't squeeze comfortably below
       ~640px without scroll. */
    .permissions-matrix-wrap { display: flex; flex-direction: column; gap: 8px; }
    .matrix-operator-note { font-size: 11.5px; color: var(--muted); }
    .permissions-matrix-scroll { overflow: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
    .permissions-matrix { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
    /* Sticky <thead> sits at z 4. Sticky first-column <th> sits at z 3 so it
       paints over body cells but under the header. The corner cell (top-left)
       is sticky in BOTH axes at z 5 so it stays put when the user scrolls
       either dimension. Without explicit z, mobile WebKit lets body cells
       overlap the sticky column on horizontal scroll. */
    .permissions-matrix thead th { position: sticky; top: 0; z-index: 4; background: var(--surface); border-bottom: 1px solid var(--border); }
    .matrix-corner, .matrix-role-head { padding: 10px 12px; text-align: left; color: var(--text-strong); font-size: 11.5px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; }
    .matrix-corner { left: 0; z-index: 5; background: var(--surface); border-right: 1px solid var(--border-soft); }
    .matrix-role-head { text-align: center; min-width: 100px; vertical-align: middle; }
    .matrix-role-head .matrix-role-name { display: block; font-family: var(--font-mono); font-size: 12px; font-weight: 800; text-transform: none; letter-spacing: -.005em; color: var(--text-strong); }
    .matrix-role-head .matrix-role-tag { display: inline-block; margin-top: 2px; font-size: 10px; opacity: .55; }
    .matrix-role-head.custom .matrix-role-name { color: var(--accent-dark); }
    .matrix-role-head .matrix-role-tag-custom { color: var(--accent); }
    .matrix-section-row .matrix-section-head { padding: 0; background: var(--surface-soft); color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; text-align: left; border-top: 1px solid var(--border-soft); border-bottom: 1px solid var(--border-soft); }
    /* Inner sticky-left span keeps the section label visible as the user
       scrolls the matrix horizontally. The outer TH still spans every column
       for the divider background; the span clamps to left: 0. */
    .matrix-section-label { display: inline-block; position: sticky; left: 0; padding: 8px 12px; background: var(--surface-soft); }
    .matrix-grant-row + .matrix-grant-row .matrix-grant-cell, .matrix-grant-row + .matrix-grant-row .matrix-cell { border-top: 1px solid var(--border-soft); }
    .matrix-grant-cell { padding: 8px 12px; text-align: left; color: var(--text); font-weight: 600; min-width: 180px; position: sticky; left: 0; z-index: 3; background: var(--surface); border-right: 1px solid var(--border-soft); }
    .matrix-grant-cell code { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-strong); }
    .matrix-cell { padding: 8px 12px; text-align: center; vertical-align: middle; color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
    /* Off cells: render a small disc via background-image so we don't depend
       on a multi-byte content character (which broke through the daemon's
       template-string serialization on a previous test build, surfacing as
       literal 'u00B7' text in cells). */
    .matrix-cell-off { color: var(--border); background-image: radial-gradient(circle, var(--border) 1.6px, transparent 1.7px); background-position: center; background-repeat: no-repeat; background-size: 6px 6px; }
    .matrix-cell-on { color: var(--accent-dark); font-weight: 800; }
    .matrix-cell-scoped { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .matrix-cell-scoped .matrix-tick { line-height: 1; }
    .matrix-cell-scoped .matrix-scope { display: inline-block; max-width: 130px; padding: 1px 6px; border-radius: 999px; background: var(--accent-light); color: var(--accent-dark); font-size: 10px; font-weight: 700; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 760px) {
      .matrix-grant-cell { min-width: 140px; }
      .matrix-role-head { min-width: 84px; padding: 8px 6px; }
      .matrix-cell { padding: 6px 4px; }
    }
    /* EP-023 / WA-106 — Settings → Diagnostics panel layout. */
    .diagnostics-settings .diagnostics-status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 18px; padding-top: 4px; }
    .diagnostics-settings .diagnostics-status-row { display: flex; flex-direction: column; gap: 1px; min-width: 120px; }
    .diagnostics-settings .diagnostics-status-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .diagnostics-settings .diagnostics-status-value { font-size: 13px; font-weight: 600; }
    .diagnostics-settings .diagnostics-log-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .diagnostics-settings .diagnostics-log-path { padding: 4px 8px; background: rgba(99, 102, 241, .07); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
    .diagnostics-settings .tui-redraw-settings > .tui-redraw-controls { grid-column: 2; grid-row: 1 / span 2; align-self: center; justify-self: start; }
    .diagnostics-settings .tui-redraw-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
    .diagnostics-settings .tui-redraw-interval { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .diagnostics-settings .tui-redraw-interval input { width: 120px; }
    .diagnostics-settings .tui-redraw-controls .settings-inline-status { margin: 0; color: var(--muted); font-size: 12px; align-self: center; }
    @media (max-width: 760px) { .diagnostics-settings .tui-redraw-settings > .tui-redraw-controls { grid-column: 1; grid-row: auto; } }
`;
