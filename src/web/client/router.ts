export interface ParsedRoute {
  workspaceId: string | null;
  page: string[];
}

export function parseRoute(pathname: string): ParsedRoute {
  function decodePart(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  const parts = String(pathname || "").split("/").filter(Boolean).map(decodePart);
  if (parts[0] === "workspaces" && parts[1]) {
    return { workspaceId: parts[1], page: parts.slice(2) };
  }
  return { workspaceId: null, page: parts };
}

export function workspacePath(id: string | null, tail: string): string {
  if (id == null && tail === "/workspaces") return "/workspaces";
  if (id == null) return "/";
  return "/workspaces/" + encodeURIComponent(id) + tail;
}

export const ROUTER_SCRIPT = `${parseRoute.toString()}\n${workspacePath.toString()}`;
