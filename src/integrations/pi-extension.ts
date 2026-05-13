/**
 * EP-031 — WhatsAgent Pi extension.
 *
 * Pi (https://pi.dev) joins claude-code/opencode/codex as the 4th
 * WhatsAgent runtime. The extension is loaded via a per-launch
 * generated bridge file under the run dir (`<displayId>.pi-extension.ts`,
 * mode 0o600), passed to Pi as `pi -e <bridge>`. The bridge re-exports
 * `createWhatsAgentPiExtension({...})`; this module owns the actual
 * factory.
 *
 * Scope as of WA-PI-3b (after WA-PI-2 skeleton, WA-PI-3a catalog):
 * - Validate the launch token from env. On failure: register no tools,
 *   skip the `before_agent_start` hook, do not start polling.
 * - When a Pi runtime API is provided (`options.pi`), iterate the
 *   public `AGENT_TOOL_CATALOG`, gate each entry with `shouldExposeTool`
 *   (which short-circuits null-family housekeeping + `mode === "off"`
 *   in one place), and call `pi.registerTool(entry.name, ...)`.
 * - Install a `before_agent_start` hook that mutates `event.systemPrompt`
 *   with the WhatsAgent colleague protocol + Pi-specific delivery note.
 *   No `pi.sendUserMessage` from extension load — Pi docs warn that
 *   creates an unsolicited turn ("Do not call session-bound methods
 *   from the extension factory itself").
 *
 * Out of scope (lands in WA-PI-4):
 * - Inbox poller + body-free `pi.sendUserMessage` follow-up signals
 *   + `markMessagesPushed` for direct/broadcast rows.
 */

import { createAgentTools, type AgentTools } from "./agent-client.ts";
import { AGENT_TOOL_CATALOG, type AgentToolDef } from "./agent-tool-catalog.ts";
import { getLaunchContext, validateLaunchContext, type FetchLike, type LaunchContext } from "./launch-token.ts";
import { loadRbacBootSnapshot, PERMISSIVE_RBAC_BOOT_SNAPSHOT, type RbacBootSnapshot } from "./rbac-snapshot.ts";
// EP-031: import from the DB-free leaf. Pi runs in Node, so the
// extension's import graph must avoid `audit-log-dao` / `rbac-dao` /
// `db.ts` (all of which depend on `bun:sqlite`). `rbac-visibility.ts`
// is the canonical source for `getToolFamily` / `shouldExposeTool` /
// `ACTION_GRANT_REQUIREMENTS`.
import { shouldExposeTool } from "../rbac-visibility.ts";
import { LruSet, defaultPushSeenCapacity } from "./lru-set.ts";
import type { MessageRow } from "../db.ts";
import { WHATSAGENT_COLLEAGUE_PROTOCOL } from "../messages/colleague-protocol.ts";

/**
 * Structural type contracts for the Pi runtime API methods we consume.
 * Defined here (rather than imported from `@mariozechner/pi-coding-agent`)
 * so the package remains an optional production dependency that the
 * generated bridge wires in. Tests inject a stub matching this shape.
 *
 * Shape pinned to https://pi.dev/docs/latest/extensions:
 *   - `pi.registerTool(definition)` takes a single argument carrying
 *     the tool name, description, parameters, and execute callback.
 *   - `execute(toolCallId, params, signal, onUpdate, ctx)` returns
 *     `{ content: [{ type: "text", text }], details? }`.
 *   - Default extension export is `(pi: ExtensionAPI) => void | Promise<void>`.
 *   - `pi.on("before_agent_start", ...)` lets the extension mutate
 *     `event.systemPrompt`.
 */
export interface PiTextContentBlock {
  type: "text";
  text: string;
}

export interface PiExecuteResult {
  content: PiTextContentBlock[];
  details?: Record<string, unknown>;
}

export type PiOnUpdate = (chunk: unknown) => void;

export type PiExecuteFn = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  onUpdate?: PiOnUpdate,
  ctx?: unknown,
) => Promise<PiExecuteResult>;

/**
 * Pi tool definition — one positional arg to `pi.registerTool`. The
 * `parameters` field is Pi's Typebox schema slot; we pass the catalog
 * `inputSchema` (JSON Schema Draft-07) through directly so the runtime
 * can introspect names + descriptions. Conversion to a Typebox `Type`
 * runtime is deferred until the `@sinclair/typebox` dep is added (Pi
 * docs reference Typebox for parameter validation; passing JSON Schema
 * still lets Pi list and call the tool, but full Typebox-level
 * validation is a release-engineering follow-up).
 */
export interface PiComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}

export interface PiRenderResultOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export interface PiThemeLike {
  fg(color: string, text: string): string;
}

export type PiRenderResultFn = (
  result: PiExecuteResult,
  options: PiRenderResultOptions,
  theme: PiThemeLike,
  context?: unknown,
) => PiComponent;

export interface PiToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: object;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute: PiExecuteFn;
  renderResult?: PiRenderResultFn;
}

export interface PiBeforeAgentStartEvent {
  systemPrompt: string;
}

export interface PiBeforeAgentStartResult {
  systemPrompt?: string;
}

export type PiBeforeAgentStartHandler = (event: PiBeforeAgentStartEvent) => PiBeforeAgentStartResult | Promise<PiBeforeAgentStartResult>;
export type PiSessionShutdownHandler = (event?: { reason?: string }) => void | Promise<void>;

export type PiSendUserMessageOptions = { deliverAs?: "steer" | "followUp" };

export interface PiExtensionApi {
  registerTool(definition: PiToolDefinition): void;
  on(event: string, handler: (event?: unknown) => unknown): void;
  /**
   * Pi user-message queue. WA-PI-4 calls this with a body-free
   * "WhatsAgent inbox has N item(s)..." signal when new pending /
   * pushed inbox rows are observed. Bodies come from check_messages.
   */
  sendUserMessage(content: string, options?: PiSendUserMessageOptions): Promise<void> | void;
}

export interface WhatsAgentPiExtensionOptions {
  /** Optional fetch override for tests. */
  fetchImpl?: FetchLike;
  /** Override the launch context env source for tests. */
  env?: Record<string, string | undefined>;
  /**
   * Pi runtime API. When provided, the factory registers tools and
   * installs the `before_agent_start` hook. The generated bridge wires
   * this in once the `@mariozechner/pi-coding-agent` SDK is available;
   * tests inject a stub.
   */
  pi?: PiExtensionApi;
  /** Push controller poll interval (ms). Floored at 250 ms. Default 1000. */
  pollIntervalMs?: number;
  /** When false, the push controller is created but does not auto-start. Tests use this. */
  startPushController?: boolean;
  /** Logger override for the push controller (defaults to `console.error` for body-free metadata only). */
  logError?: (message: string) => void;
}

export interface PiPushController {
  /** Run a single poll + signal cycle. Returns the number of new rows signaled. */
  pollOnce(): Promise<number>;
  /** Start auto-polling on the configured interval. Idempotent. */
  start(): void;
  /** Stop auto-polling. Idempotent. Pending in-flight pollOnce is allowed to settle. */
  stop(): void;
  /** True when auto-polling is active. */
  readonly running: boolean;
}

export interface WhatsAgentPiExtensionState {
  /** True when the launch token validated and tools were created. */
  ready: boolean;
  /** AgentTools instance bound to the validated launch context. */
  tools: AgentTools | null;
  /** Launch context resolved from env, when present. */
  context: LaunchContext | null;
  /** When ready=false, the reason. */
  reason?: "no_launch_context" | "invalid_launch_token";
  /** RBAC snapshot used to gate registration. Permissive on failure. */
  rbac: RbacBootSnapshot;
  /** Canonical names of tools registered via pi.registerTool. */
  registeredToolNames: readonly string[];
  /** True when the before_agent_start hook was installed. */
  beforeAgentStartInstalled: boolean;
  /** Push controller instance. Null when no Pi runtime was injected. */
  pushController: PiPushController | null;
}

const PI_DELIVERY_NOTE = `\nDELIVERY ON THIS SIDE (Pi):\n\nPi receives WhatsAgent tools through this extension. Live messages may surface as a body-free follow-up signal ("WhatsAgent inbox has N item(s). Call check_messages now.") via Pi's user-message queue. The signal carries no message body — call check_messages to get the audited WHATSAGENT INBOX envelope.\n\nSignal coalescing (WA-228): WhatsAgent fires at most one inbox signal at a time and waits for you to drain the inbox before sending another. If you ignore a signal and return without calling check_messages, the controller may re-fire after a delay, but during a long-running turn no further signals will arrive — they all collapse into the single pending signal. Practical consequence: do not assume "another nudge will come soon". When you see an inbox signal, call check_messages this turn, before continuing the substantive work. A single check_messages call drains every queued item, so spending one tool call there is cheaper than chasing missed rows turns later.\n\nOn launch, call whoami, list_peers, check_messages, and set_summary before starting substantive work. On every later user turn, call check_messages before answering or changing files. Reply only when substantive; do not auto-acknowledge.\n`;

function piGuidanceText(): string {
  return `${WHATSAGENT_COLLEAGUE_PROTOCOL.trimEnd()}\n${PI_DELIVERY_NOTE}`;
}

/**
 * Pi extension factory. Returns a state object describing whether the
 * extension successfully bound to a validated launch context, plus the
 * names of every tool that was registered with the Pi runtime.
 *
 * Behavior:
 * - No launch token in env → `ready=false`, `reason="no_launch_context"`,
 *   no registration.
 * - Launch token rejected by daemon → `ready=false`,
 *   `reason="invalid_launch_token"`, no registration.
 * - Validation OK + `options.pi` undefined → `ready=true`, AgentTools
 *   bound, no registration (the bridge has not wired the SDK in yet).
 * - Validation OK + `options.pi` provided → register every catalog
 *   entry that passes `shouldExposeTool`; install `before_agent_start`
 *   hook that appends WhatsAgent guidance to `event.systemPrompt`.
 */
export async function createWhatsAgentPiExtension(options: WhatsAgentPiExtensionOptions = {}): Promise<WhatsAgentPiExtensionState> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const context = getLaunchContext(env);
  if (!context) {
    return {
      ready: false,
      tools: null,
      context: null,
      reason: "no_launch_context",
      rbac: PERMISSIVE_RBAC_BOOT_SNAPSHOT,
      registeredToolNames: [],
      beforeAgentStartInstalled: false,
      pushController: null,
    };
  }
  const valid = await validateLaunchContext(context, fetchImpl);
  if (!valid) {
    return {
      ready: false,
      tools: null,
      context,
      reason: "invalid_launch_token",
      rbac: PERMISSIVE_RBAC_BOOT_SNAPSHOT,
      registeredToolNames: [],
      beforeAgentStartInstalled: false,
      pushController: null,
    };
  }
  const tools = createAgentTools(context, fetchImpl);
  const rbac = await loadRbacBootSnapshot(context, fetchImpl);
  const pi = options.pi;
  if (!pi) {
    return { ready: true, tools, context, rbac, registeredToolNames: [], beforeAgentStartInstalled: false, pushController: null };
  }
  const registered: string[] = [];
  for (const entry of AGENT_TOOL_CATALOG) {
    if (!shouldExposeTool(entry.name, rbac.toolFamilies, rbac.mode)) continue;
    pi.registerTool(toolDefinitionForPi(entry, tools));
    registered.push(entry.name);
  }
  pi.on("before_agent_start", async (event) => {
    const beforeAgentStart = isRecord(event) ? event as unknown as PiBeforeAgentStartEvent : { systemPrompt: "" };
    return { systemPrompt: `${beforeAgentStart.systemPrompt ?? ""}\n\n${piGuidanceText()}`.trimStart() };
  });
  const pushController = createPiPushController(tools, pi, {
    pollIntervalMs: options.pollIntervalMs,
    logError: options.logError,
  });
  pi.on("session_shutdown", () => {
    pushController.stop();
  });
  if (options.startPushController !== false) pushController.start();
  return {
    ready: true,
    tools,
    context,
    rbac,
    registeredToolNames: registered,
    beforeAgentStartInstalled: true,
    pushController,
  };
}

interface PiPushControllerOptions {
  pollIntervalMs?: number;
  /**
   * Max backoff between poll attempts when consecutive failures occur.
   * Effective interval is `min(maxBackoffMs, pollIntervalMs * 2^consecutiveFailures)`.
   * Defaults to 30s; matches OpenCode push controller.
   */
  maxBackoffMs?: number;
  /**
   * Minimum interval between repeated logs of the same poll-error message.
   * Defaults to 60s. Within the window, repeats are silently counted and
   * surfaced in the next emitted log via a "(suppressed N ...)" suffix.
   */
  errorLogIntervalMs?: number;
  /**
   * WA-228 drain window: consecutive ms of empty `pollMessages` results
   * required to clear `pendingSignal`. "Empty" means DB-empty
   * (`messages.length === 0`), not LRU-empty — drain implies the agent
   * acked via check_messages, not that the controller has already
   * signaled every row. Defaults to 8000ms.
   */
  minDrainMs?: number;
  /**
   * WA-228 refire failsafe: when `pendingSignal` has been outstanding for
   * this many ms AND no agent turn is currently active, fire one more
   * signal even though we have not observed drain. Guards against the
   * agent silently dropping the first signal. Defaults to 30000ms.
   */
  refireMs?: number;
  now?: () => number;
  logError?: (message: string) => void;
}

/**
 * Pi follow-up push controller. WA-PI-4 + WA-228.
 *
 * Behavior:
 * - Polls `tools.pollMessages(50)` on a bounded interval (default 1000 ms,
 *   floor 250 ms).
 * - Suppresses repeat signals on the same row in one Pi process via a
 *   bounded `LruSet` (matches OpenCode's `pushed` tracker pattern).
 * - Coalesces all newly observed rows into one body-free signal:
 *     pi.sendUserMessage("WhatsAgent inbox has N item(s). Call check_messages now.",
 *                        { deliverAs: "followUp" });
 *   The signal text NEVER includes message bodies, sender text, envelope
 *   text, Kanban details, channel body, or launch token values.
 * - WA-228 signal coalescing + turn-liveness gate: once a signal lands,
 *   `pendingSignal` blocks further signals until one of:
 *   - DB drain: `tools.pollMessages` returns an empty list for at least
 *     `minDrainMs` while no agent turn is active (the agent acked via
 *     check_messages, which transitions rows out of pending+pushed). The
 *     drain test deliberately uses `messages.length === 0`, NOT
 *     `fresh.length === 0`, so LRU-filtered rows that are still pending
 *     in the DB do not falsely trigger drain.
 *   - Refire failsafe: `pendingSignal` has been outstanding for
 *     `refireMs` AND no agent turn is active. Fires one fresh signal in
 *     case the prior one was dropped by the runtime.
 * - WA-228 turn-liveness: `pi.on("agent_start")` flips `agentTurnActive`
 *   true; `pi.on("agent_end")` flips it false. While true, drain progress
 *   and the refire failsafe pause. New fresh rows arriving mid-turn are
 *   silently absorbed into the LRU (and direct/broadcast marked pushed)
 *   so the next pollOnce after the turn ends does not double-signal.
 * - On successful signal, marks direct + broadcast rows as `pushed` via
 *   `tools.markMessagesPushed(messageIds)`. Channel + Kanban rows are
 *   intentionally left pending — their delivery cursors live elsewhere
 *   (`channel_reads`, `kanban_notifications.read_at`) and routing them
 *   through markMessagesPushed would re-deliver every poll. Mirrors the
 *   `markDirectPushed` filter in `src/integrations/opencode-plugin.ts:488-495`.
 * - Failure paths are body-free:
 *   - `sendUserMessage` throws → keep rows OUT of the LRU so the next
 *     poll retries; do not flip `pendingSignal`.
 *   - `markMessagesPushed` throws after a successful signal → keep rows
 *     IN the LRU (avoid double-signal); log body-free metadata only.
 *   - Errors logged via `logError` carry only message ids and counts;
 *     never bodies or launch-token values.
 */
export function createPiPushController(tools: AgentTools, pi: PiExtensionApi, options: PiPushControllerOptions = {}): PiPushController {
  const intervalMs = Math.max(250, options.pollIntervalMs ?? 1000);
  const maxBackoffMs = Math.max(intervalMs, options.maxBackoffMs ?? 30_000);
  const errorLogIntervalMs = Math.max(0, options.errorLogIntervalMs ?? 60_000);
  const minDrainMs = Math.max(0, options.minDrainMs ?? 8_000);
  const refireMs = Math.max(0, options.refireMs ?? 30_000);
  const now = options.now ?? (() => Date.now());
  const logError = options.logError ?? ((msg: string) => console.error(msg));
  const pushed = new LruSet(defaultPushSeenCapacity());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let inflight = false;
  let piRef: PiExtensionApi | null = pi;
  let consecutiveFailures = 0;
  let lastErrorMessage = "";
  let lastErrorLoggedAt = Number.NEGATIVE_INFINITY;
  let suppressedErrorCount = 0;
  // WA-228 state.
  let pendingSignal = false;
  let lastSignalAt = Number.NEGATIVE_INFINITY;
  let agentTurnActive = false;
  let drainStartedAt: number | null = null;

  pi.on("agent_start", () => { agentTurnActive = true; });
  pi.on("agent_end", () => {
    agentTurnActive = false;
    // Reset drain progress so the post-turn window starts fresh; agent
    // may not have acked, in which case the next poll's DB result will
    // immediately abort drain anyway.
    drainStartedAt = null;
  });

  const signalText = (count: number): string => `WhatsAgent inbox has ${count} item${count === 1 ? "" : "s"}. Call check_messages now.`;
  const stopController = (): void => {
    stopped = true;
    piRef = null;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const markDirectBroadcastPushed = async (rows: MessageRow[]): Promise<void> => {
    const ids = rows.filter((m) => m.delivery_kind === "direct" || m.delivery_kind === "broadcast").map((m) => m.id);
    if (ids.length === 0) return;
    try {
      await tools.markMessagesPushed(ids);
    } catch (err) {
      logError(`[whatsagent/pi-push] markMessagesPushed failed for ids=[${ids.join(",")}]: ${asErrorMessage(err)}`);
    }
  };

  const pollOnce = async (): Promise<number> => {
    if (inflight) return 0;
    inflight = true;
    try {
      const polled = await tools.pollMessages(50) as { messages?: MessageRow[] };
      if (piRef === null) return 0;
      const messages = Array.isArray(polled.messages) ? polled.messages : [];
      const time = now();

      // DB-empty: candidate drain. Only counts toward drain when a signal
      // is outstanding AND no turn is active.
      if (messages.length === 0) {
        if (pendingSignal && !agentTurnActive) {
          if (drainStartedAt === null) {
            drainStartedAt = time;
          } else if (time - drainStartedAt >= minDrainMs) {
            pendingSignal = false;
            drainStartedAt = null;
          }
        } else {
          drainStartedAt = null;
        }
        return 0;
      }

      // DB has rows → drain progress aborts.
      drainStartedAt = null;
      const fresh = messages.filter((m) => !pushed.has(messageKey(m)));
      const shouldRefire = pendingSignal && !agentTurnActive && time - lastSignalAt >= refireMs;

      // Coalesce gate: signal already pending and not yet eligible for
      // refire. Absorb any newly-fresh rows so they cannot retrigger a
      // signal once `pendingSignal` clears.
      if (pendingSignal && !shouldRefire) {
        if (fresh.length === 0) return 0;
        for (const m of fresh) pushed.add(messageKey(m));
        await markDirectBroadcastPushed(fresh);
        return 0;
      }

      // No outstanding signal AND nothing new to flag → nothing to do.
      if (fresh.length === 0 && !shouldRefire) return 0;

      const currentPi = piRef;
      if (currentPi === null) return 0;
      const signalCount = fresh.length > 0 ? fresh.length : messages.length;
      try {
        await currentPi.sendUserMessage(signalText(signalCount), { deliverAs: "followUp" });
      } catch (err) {
        // Signal failed; do NOT add to LRU, do NOT flip pendingSignal.
        // Stop the scheduled controller and clear piRef because stale Pi
        // session-bound references keep throwing after session
        // replacement / shutdown.
        stopController();
        logError(`[whatsagent/pi-push] sendUserMessage failed for ${signalCount} row(s): ${asErrorMessage(err)}`);
        return 0;
      }

      // Signal landed: flip gate, capture in LRU before mark-pushed so a
      // markPushed failure cannot trigger a duplicate sendUserMessage on
      // retry.
      pendingSignal = true;
      lastSignalAt = time;
      drainStartedAt = null;
      for (const m of fresh) pushed.add(messageKey(m));
      await markDirectBroadcastPushed(fresh);
      return signalCount;
    } finally {
      inflight = false;
    }
  };

  const reportPollError = (err: unknown): void => {
    const message = asErrorMessage(err);
    const currentTime = now();
    if (message === lastErrorMessage && currentTime - lastErrorLoggedAt < errorLogIntervalMs) {
      suppressedErrorCount++;
      return;
    }
    const suppressedSuffix = suppressedErrorCount > 0
      ? ` (suppressed ${suppressedErrorCount} repeated ${suppressedErrorCount === 1 ? "error" : "errors"})`
      : "";
    const timestamp = new Date(currentTime).toISOString();
    logError(`[whatsagent/pi-push] poll error at ${timestamp}: ${message}${suppressedSuffix} — if WhatsAgent daemon was restarted around this time, this can be safely ignored`);
    lastErrorMessage = message;
    lastErrorLoggedAt = currentTime;
    suppressedErrorCount = 0;
  };

  const clearErrorState = (): void => {
    consecutiveFailures = 0;
    lastErrorMessage = "";
    lastErrorLoggedAt = Number.NEGATIVE_INFINITY;
    suppressedErrorCount = 0;
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await pollOnce();
      clearErrorState();
    } catch (err) {
      consecutiveFailures++;
      reportPollError(err);
    } finally {
      if (!stopped) {
        const delay = Math.min(maxBackoffMs, intervalMs * (2 ** consecutiveFailures));
        timer = setTimeout(tick, delay);
      }
    }
  };

  return {
    pollOnce,
    start() {
      if (!stopped) return;
      if (piRef === null) piRef = pi;
      stopped = false;
      timer = setTimeout(tick, intervalMs);
    },
    stop() {
      stopController();
    },
    get running() { return !stopped; },
  };
}

function asErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Compound LRU key for the push controller's `pushed` tracker. Mirrors
 * `messageKey` in `src/integrations/opencode-plugin.ts:754-762`. Direct,
 * broadcast, channel, and Kanban rows live in different tables and can
 * share numeric ids; keying by `delivery_kind` (plus channel id /
 * kanban notification id) prevents one source's row from silently
 * suppressing another's.
 */
function messageKey(message: MessageRow): string {
  if (message.delivery_kind === "kanban" && message.kanban_epic_notification_id != null) {
    return `kanban-epic::${message.kanban_epic_notification_id}`;
  }
  if (message.delivery_kind === "kanban") {
    return `kanban::${message.kanban_notification_id ?? message.id}`;
  }
  return `${message.delivery_kind}:${message.channel_id ?? ""}:${message.id}`;
}

function toolDefinitionForPi(entry: AgentToolDef, tools: AgentTools): PiToolDefinition {
  return {
    name: entry.name,
    label: humanizeToolLabel(entry.name),
    description: entry.description,
    parameters: entry.inputSchema,
    async execute(_toolCallId, params) {
      const result = await entry.execute(tools, isRecord(params) ? params : {});
      const text = typeof result === "string" ? result : safeJsonStringify(result);
      return {
        content: [{ type: "text", text: truncatePiToolContent(text) }],
        details: { data: result },
      };
    },
    renderResult(result, options, theme) {
      return renderPiToolResult(entry, result, options, theme);
    },
  };
}

function humanizeToolLabel(name: string): string {
  return name.split("_").map((part) => part.length === 0 ? "" : part[0]!.toUpperCase() + part.slice(1)).join(" ");
}

function renderPiToolResult(entry: AgentToolDef, result: PiExecuteResult, options: PiRenderResultOptions, theme: PiThemeLike): PiComponent {
  if (options.isPartial) return new SimplePiText(theme.fg("warning", "Processing..."));
  const details = isRecord(result.details) ? result.details : {};
  const data = "data" in details ? details.data : undefined;
  const error = typeof details.error === "string" ? details.error : errorFromData(data);
  if (error.length > 0) {
    return new SimplePiText(theme.fg("error", `Error: ${error}`));
  }
  const summary = entry.summarize(data);
  let text = theme.fg("success", summary);
  if (options.expanded && data !== undefined) {
    text += `\n${theme.fg("dim", safeJsonStringify(data))}`;
  }
  return new SimplePiText(text);
}

class SimplePiText implements PiComponent {
  constructor(private text: string) {}
  render(width: number): string[] {
    return this.text.split("\n").flatMap((line) => wrapLineToWidth(line, width));
  }
  invalidate(): void {}
}

const PI_TOOL_MAX_BYTES = 50 * 1024;
const PI_TOOL_MAX_LINES = 2000;
const TRUNCATION_NOTICE = "\n\n[WhatsAgent tool output truncated to 50KB / 2000 lines for Pi context; expanded UI details retain the structured result.]";

function truncatePiToolContent(text: string): string {
  const encoder = new TextEncoder();
  const originalBytes = encoder.encode(text).byteLength;
  const originalLines = text.split("\n").length;
  if (originalBytes <= PI_TOOL_MAX_BYTES && originalLines <= PI_TOOL_MAX_LINES) return text;

  const budget = Math.max(0, PI_TOOL_MAX_BYTES - encoder.encode(TRUNCATION_NOTICE).byteLength);
  const byLines = text.split("\n").slice(0, PI_TOOL_MAX_LINES).join("\n");
  return clipToUtf8Budget(byLines, budget) + TRUNCATION_NOTICE;
}

function clipToUtf8Budget(text: string, budget: number): string {
  if (budget <= 0) return "";
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= budget) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, mid)).byteLength <= budget) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low);
}

function wrapLineToWidth(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  const lines: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    lines.push(line.slice(index, index + width));
  }
  return lines.length > 0 ? lines : [""];
}

function errorFromData(data: unknown): string {
  if (!isRecord(data)) return "";
  return data.ok === false && typeof data.error === "string" ? data.error : "";
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default createWhatsAgentPiExtension;
