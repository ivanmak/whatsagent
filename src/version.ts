import pkg from "../package.json" with { type: "json" };

export const WHATSAGENT_VERSION: string = pkg.version;

function formatBuildStamp(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

export const WHATSAGENT_BUILD = formatBuildStamp(new Date());
