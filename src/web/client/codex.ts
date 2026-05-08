// @ts-nocheck
// Codex UI glue feature module.
// Lift of installCodexHostUi() per
// docs/superpowers/specs/2026-05-01-web-client-modularisation-design.md.
// Owns: pending-nudge helper, runner-snapshot extension, agent-tab dot
// nudge state, terminal nudge toast, codex-aware status-poll path.
// Pre-WA-033 the codex IIFE also wrapped renderAgentOverview /
// launchControl / renderLaunchDialog (overwritten by
// installAgentListAndSettingsUi without calling originals) and a fleet
// settings tab (dead because settings aliases route fleet -> runtime
// and the fleet id is not in the tab order). Those wraps are removed
// in this lift.

let _ctx = null;
function ctx() {
  if (!_ctx) throw new Error('codex context not bound; call installCodex(ctx) first');
  return _ctx;
}
function getState() { return ctx().getState(); }
function patchState(partial) { ctx().patchState(partial); }
function getPage() { return ctx().getPage(); }
function getActiveTerminal() { return ctx().getActiveTerminal(); }
function getAttentionRoles() { return ctx().getAttentionRoles(); }
function shouldPollWorkspace() { return ctx().shouldPollWorkspace(); }
function workspaceFetch(suffix, init) { return ctx().workspaceFetch(suffix, init); }
function activeTerminalRole() { return ctx().activeTerminalRole(); }
function getRunnerSnapshot() { return ctx().getRunnerSnapshot(); }
function setRunnerSnapshot(value) { ctx().setRunnerSnapshot(value); }
function getRepoRoleSnapshot() { return ctx().getRepoRoleSnapshot ? ctx().getRepoRoleSnapshot() : ''; }
function setRepoRoleSnapshot(value) { if (ctx().setRepoRoleSnapshot) ctx().setRepoRoleSnapshot(value); }
function repoRoleSnapshotFor(stateLike) { return ctx().repoRoleSnapshotFor ? ctx().repoRoleSnapshotFor(stateLike) : ''; }
function notifyRunnerExits(next, prev) { ctx().notifyRunnerExits(next, prev); }
function updateLiveCounts() { ctx().updateLiveCounts(); }
function scheduleStatusPoll(delay) { ctx().scheduleStatusPoll(delay); }
function render() { ctx().render(); }
function $(id) { return ctx().$(id); }
function esc(value) { return ctx().esc(value); }
function runnerFor(name) { return ctx().runnerFor(name); }

function codexPendingNudge(runner) {
  return runner?.host_type === 'codex' && runner?.pending_nudge ? runner.pending_nudge : null;
}

// EP-DEC-RUN WA-006 (advisor msg #28): identity is display_id so two
// same-bare-name codex runners snapshot/compare distinctly.
function codexAddr(runner) { return runner.display_id || runner.role; }

export function codexRunnerSnapshotFor(runners) {
  return JSON.stringify((runners || []).map(runner => [
    codexAddr(runner),
    runner.session_id,
    Boolean(runner.reachable),
    runner.status || '',
    runner.runner_pid || 0,
    runner.child_pid || 0,
    runner.exit_code ?? '',
    runner.exit_signal || '',
    runner.exited_at || '',
    JSON.stringify(runner.pending_nudge || null),
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))));
}

export function codexAgentTabDot(roleName, runner) {
  const pending = codexPendingNudge(runner);
  const attentionRoles = getAttentionRoles();
  const cls = pending ? 'nudge-blocked' : !runner ? 'offline' : attentionRoles[roleName] ? 'attention' : 'online';
  const label = pending ? 'inbox nudge delayed by Codex draft' : cls === 'attention' ? 'online, attention needed' : cls === 'online' ? 'online' : 'offline';
  return '<span class="agent-tab-dot ' + cls + '" title="' + esc(label) + '"></span>';
}

export function codexNudgeToast(roleName) {
  const runner = runnerFor(roleName);
  const pending = codexPendingNudge(runner);
  if (!pending) return;
  const terminal = $('agentTabContent')?.querySelector?.('.terminal');
  const detail = pending.blocked_by_draft
    ? 'A WhatsAgent message arrived while a Codex draft appears to be in progress. Open Prompts to insert the inbox nudge when ready.'
    : 'A WhatsAgent message is waiting. Use Prompts to insert the inbox nudge when ready.';
  terminal?.insertAdjacentHTML('afterbegin', '<div class="codex-nudge-toast" role="status" aria-live="polite"><strong>Codex inbox waiting</strong><span>' + esc(detail) + '</span></div>');
}

export async function codexPollStatus() {
  if (!shouldPollWorkspace()) { scheduleStatusPoll(); return; }
  const state = getState();
  const gen = state.workspaceGeneration;
  try {
    const previousRunners = state.runners || [];
    const activeRole = activeTerminalRole();
    // EP-DEC-RUN WA-006 (advisor msg #28): activeRole is now displayId,
    // so match runners via display_id (with bare-name fallback for legacy
    // state during transition).
    const matchActive = (r) => r.display_id === activeRole || r.role === activeRole;
    const previousActive = activeRole ? previousRunners.find(matchActive) : null;
    const next = await workspaceFetch('/status').then(r => r.json());
    if (gen !== getState().workspaceGeneration) return;
    const nextState = { ...getState(), ...next };
    const nextSnapshot = codexRunnerSnapshotFor(nextState.runners || []);
    // EP-002 WA-007 (advisor msg #36): port the repo/role snapshot gate
    // here too — the base pollStatus carrying the gate is dead because
    // installCodex replaces it with this poller.
    const nextRepoRole = repoRoleSnapshotFor(nextState);
    const runnerChanged = nextSnapshot !== getRunnerSnapshot();
    const repoRoleChanged = nextRepoRole !== getRepoRoleSnapshot();
    notifyRunnerExits(nextState.runners || [], previousRunners);
    patchState(next);
    if (runnerChanged || repoRoleChanged) {
      setRunnerSnapshot(nextSnapshot);
      setRepoRoleSnapshot(nextRepoRole);
      if (runnerChanged) updateLiveCounts();
      const stateNow = getState();
      const activeNext = activeRole ? (stateNow.runners || []).find(matchActive) : null;
      const activeNudgeChanged = JSON.stringify(previousActive?.pending_nudge || null) !== JSON.stringify(activeNext?.pending_nudge || null);
      // EP-002 WA-009 (advisor msg #36): rerender on offline → reachable
      // transition for the active role so a freshly-launched runner mounts
      // its TUI without an F5. Same gate as the (now-dead) base poll path.
      const activeBecameReachable = Boolean(activeRole) && Boolean(activeNext?.reachable) && !previousActive?.reachable;
      if (repoRoleChanged || activeBecameReachable || getPage() !== 'agents' || getActiveTerminal() === 'overview' || (activeRole && !activeNext?.reachable) || activeNudgeChanged) render();
    }
  } catch {}
  scheduleStatusPoll();
}

export function installCodex(c) {
  _ctx = c;
}
