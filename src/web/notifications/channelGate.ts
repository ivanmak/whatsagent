import type { EventKind, NotificationPrefsV3 } from "./prefs.ts";

export function shouldFire(channel: "browser" | "toast" | "sound", kind: EventKind, prefs: NotificationPrefsV3): boolean {
  if (channel === "browser" && !prefs.browserEnabled) return false;
  if (channel === "toast"   && !prefs.toastEnabled)   return false;
  if (channel === "sound"   && !prefs.enabled)        return false;
  if (channel === "sound") {
    const sound = prefs.events[kind].sound;
    return sound === "Default" ? prefs.defaultSound !== "Off" : sound !== "Off";
  }
  return prefs.events[kind][channel];
}
