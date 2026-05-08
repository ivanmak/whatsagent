import type { Database } from "bun:sqlite";

import { getDaemonSetting, setDaemonSetting } from "../daemon-db.ts";
import { WHATSAGENT_COLLEAGUE_PROTOCOL } from "./colleague-protocol.ts";

export interface AgentTextSettings {
  colleagueProtocol: string;
  inboxInstructions: string;
  pushedInboxInstructions: string;
}

export const AGENT_TEXT_SETTINGS_KEY = "agent_text_settings_v1";

export const DEFAULT_INBOX_INSTRUCTIONS = [
  "Read each one. Then:",
  "- Question you can answer: reply briefly with listed actions.",
  "- Needs investigation: investigate first; reply only with answer, blocker, or clarifying question.",
  "- FYI: no reply needed. Disagree/cannot comply: say why.",
  "Do NOT auto-acknowledge. 'Got it' / 'on it' is noise.",
  "If mid-task, return to your original task unless message says stop or blocks you.",
].join("\n");

export const DEFAULT_PUSHED_INBOX_INSTRUCTIONS = "Pushed WHATSAGENT INBOX: handle now, then resume prior task. Reply only when substantive; do not auto-acknowledge.";

export const DEFAULT_AGENT_TEXT_SETTINGS: AgentTextSettings = {
  colleagueProtocol: WHATSAGENT_COLLEAGUE_PROTOCOL.trimEnd(),
  inboxInstructions: DEFAULT_INBOX_INSTRUCTIONS,
  pushedInboxInstructions: DEFAULT_PUSHED_INBOX_INSTRUCTIONS,
};

const MAX_TEXT_SETTING_LENGTH = 24_000;

export function normalizeAgentTextSettings(input: unknown): AgentTextSettings {
  const value = input && typeof input === "object" ? input as Partial<Record<keyof AgentTextSettings, unknown>> : {};
  return {
    colleagueProtocol: cleanTextSetting(value.colleagueProtocol, DEFAULT_AGENT_TEXT_SETTINGS.colleagueProtocol),
    inboxInstructions: cleanTextSetting(value.inboxInstructions, DEFAULT_AGENT_TEXT_SETTINGS.inboxInstructions),
    pushedInboxInstructions: cleanTextSetting(value.pushedInboxInstructions, DEFAULT_AGENT_TEXT_SETTINGS.pushedInboxInstructions),
  };
}

export function getAgentTextSettings(daemonDb: Database): AgentTextSettings {
  const stored = getDaemonSetting(daemonDb, AGENT_TEXT_SETTINGS_KEY);
  if (!stored) return DEFAULT_AGENT_TEXT_SETTINGS;
  try {
    return normalizeAgentTextSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_AGENT_TEXT_SETTINGS;
  }
}

export function setAgentTextSettings(daemonDb: Database, input: unknown): AgentTextSettings {
  const settings = normalizeAgentTextSettings(input);
  setDaemonSetting(daemonDb, AGENT_TEXT_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function resetAgentTextSettings(daemonDb: Database): AgentTextSettings {
  setDaemonSetting(daemonDb, AGENT_TEXT_SETTINGS_KEY, JSON.stringify(DEFAULT_AGENT_TEXT_SETTINGS));
  return DEFAULT_AGENT_TEXT_SETTINGS;
}

function cleanTextSetting(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.slice(0, MAX_TEXT_SETTING_LENGTH).trim();
  return text.length > 0 ? text : fallback;
}
