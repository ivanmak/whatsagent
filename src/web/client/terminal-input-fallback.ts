import { enqueueSerial, type SerialQueueMap } from "./serial-queue.ts";

type RunnerLike = { session_id?: string; sessionId?: string } | null | undefined;
type RoleLike = { id?: string | null } | null | undefined;
type ResponseLike = { ok?: boolean; json?: () => Promise<unknown> } | null | undefined;

export interface TerminalInputFallbackDeps {
  activeRole(): string | null | undefined;
  currentWorkspaceId(): string | null | undefined;
  workspaceGeneration(): number;
  runnerFor(role: string): RunnerLike;
  roleByAddress(role: string): RoleLike;
  postInput(workspaceId: string, roleId: string, data: string): Promise<ResponseLike>;
  onRejected(role: string, body: unknown): void;
  newline: string;
}

export interface TerminalInputSnapshot {
  role: string;
  value: string;
  raw: boolean;
  workspaceId: string;
  workspaceGeneration: number;
  roleId: string;
  sessionId: string;
}

function runnerSessionId(runner: RunnerLike): string {
  return String(runner?.session_id || runner?.sessionId || "");
}

export function terminalInputQueueKey(snapshot: Pick<TerminalInputSnapshot, "workspaceId" | "roleId" | "sessionId">): string {
  return `${snapshot.workspaceId}\u0000${snapshot.roleId}\u0000${snapshot.sessionId}`;
}

export function isTerminalInputSnapshotCurrent(deps: TerminalInputFallbackDeps, snapshot: TerminalInputSnapshot): boolean {
  if (deps.currentWorkspaceId() !== snapshot.workspaceId) return false;
  if (deps.workspaceGeneration() !== snapshot.workspaceGeneration) return false;
  if (deps.roleByAddress(snapshot.role)?.id !== snapshot.roleId) return false;
  return runnerSessionId(deps.runnerFor(snapshot.role)) === snapshot.sessionId;
}

export async function sendTerminalInputSnapshot(deps: TerminalInputFallbackDeps, snapshot: TerminalInputSnapshot): Promise<void> {
  if (!isTerminalInputSnapshotCurrent(deps, snapshot)) return;
  const data = snapshot.raw ? snapshot.value : snapshot.value + deps.newline;
  const res = await deps.postInput(snapshot.workspaceId, snapshot.roleId, data).catch(() => null);
  if (!isTerminalInputSnapshotCurrent(deps, snapshot)) return;
  if (!res?.ok) {
    const body = res ? await res.json?.().catch(() => ({})) : {};
    deps.onRejected(snapshot.role, body ?? {});
  }
}

export function enqueueTerminalInputFallback(
  queue: SerialQueueMap,
  deps: TerminalInputFallbackDeps,
  value: string,
  raw = false,
  roleOverride?: string | null,
): Promise<void> | undefined {
  const role = roleOverride || deps.activeRole();
  if (!role || !value) return undefined;
  const runner = deps.runnerFor(role);
  if (!runner) {
    deps.onRejected(role, { status: "offline" });
    return undefined;
  }
  const sessionId = runnerSessionId(runner);
  const workspaceId = deps.currentWorkspaceId();
  const target = deps.roleByAddress(role);
  if (!workspaceId || !target?.id || !sessionId) return undefined;
  const snapshot: TerminalInputSnapshot = {
    role,
    value,
    raw,
    workspaceId,
    workspaceGeneration: deps.workspaceGeneration(),
    roleId: target.id,
    sessionId,
  };
  return enqueueSerial(queue, terminalInputQueueKey(snapshot), () => sendTerminalInputSnapshot(deps, snapshot));
}
