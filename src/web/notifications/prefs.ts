export type SoundName = "Chime" | "Pulse" | "Signal" | "Tap" | "Off";
export type EventSoundName = SoundName | "Default";
export type EventKind = "new_message" | "runner_exit" | "approval_waiting" | "codex_nudge_blocked" | "codex_inbox_pending" | "launch_failure";

export type EventPrefs = { browser: boolean; toast: boolean; sound: EventSoundName };

export type NotificationPrefsV3 = {
  version: 3;
  enabled: boolean;
  browserEnabled: boolean;
  toastEnabled: boolean;
  defaultSound: SoundName;
  soundThrottle: "short" | "standard" | "long";
  events: Record<EventKind, EventPrefs>;
};

export const DEFAULT_PREFS_V3: NotificationPrefsV3 = {
  version: 3,
  enabled: true,
  browserEnabled: true,
  toastEnabled: true,
  defaultSound: "Chime",
  soundThrottle: "standard",
  events: {
    new_message:         { browser: true, toast: true, sound: "Default" },
    runner_exit:         { browser: true, toast: true, sound: "Default" },
    approval_waiting:    { browser: true, toast: true, sound: "Default" },
    codex_nudge_blocked: { browser: true, toast: true, sound: "Default" },
    codex_inbox_pending: { browser: true, toast: true, sound: "Default" },
    launch_failure:      { browser: true, toast: true, sound: "Default" },
  },
};

export function migratePrefsV2ToV3(rawNotif: Record<string, unknown>, rawUiPrefs: Record<string, unknown>): NotificationPrefsV3 {
  const ALL_KINDS = ["new_message", "runner_exit", "approval_waiting", "codex_nudge_blocked", "codex_inbox_pending", "launch_failure"];
  const VALID_SOUNDS = ["Chime", "Pulse", "Signal", "Tap", "Off"];
  const VALID_EVENT_SOUNDS = ["Default", ...VALID_SOUNDS];
  function asSoundName(value: unknown, fallback: SoundName): SoundName {
    return VALID_SOUNDS.indexOf(value as string) >= 0 ? (value as SoundName) : fallback;
  }
  function asEventSoundName(value: unknown): EventSoundName {
    return (VALID_EVENT_SOUNDS.indexOf(value as string) >= 0 ? (value as EventSoundName) : "Default");
  }
  function asThrottle(value: unknown): string {
    return value === "short" || value === "long" ? value : "standard";
  }

  const fromV2: Record<string, boolean> = {
    new_message:         rawUiPrefs.notifyMessages !== false,
    runner_exit:         rawUiPrefs.notifyRunnerExits !== false,
    approval_waiting:    rawNotif.approvalWaiting !== false,
    codex_nudge_blocked: rawNotif.nudgeBlocked !== false,
    codex_inbox_pending: rawNotif.codexInboxPending !== false,
    launch_failure:      rawNotif.launchFailures !== false,
  };

  const inputEvents: Record<string, unknown> = (rawNotif.events && typeof rawNotif.events === "object")
    ? (rawNotif.events as Record<string, unknown>)
    : {};

  const events: Record<string, EventPrefs> = {};
  for (const kind of ALL_KINDS) {
    const v2on: boolean = fromV2[kind] ?? true;
    const v3 = inputEvents[kind] as Record<string, unknown> | undefined;
    events[kind] = {
      browser: typeof v3?.browser === "boolean" ? v3.browser : v2on,
      toast:   typeof v3?.toast === "boolean"   ? v3.toast   : v2on,
      sound:   asEventSoundName(v3?.sound),
    };
  }

  return {
    version: 3,
    enabled:        rawNotif.enabled !== false,
    browserEnabled: rawNotif.browserEnabled !== false,
    toastEnabled:   rawNotif.toastEnabled !== false,
    defaultSound:   asSoundName(rawNotif.defaultSound, "Chime"),
    soundThrottle:  asThrottle(rawNotif.soundThrottle) as NotificationPrefsV3["soundThrottle"],
    events: events as Record<EventKind, EventPrefs>,
  };
}
