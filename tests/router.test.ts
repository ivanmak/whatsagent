import { expect, test } from "bun:test";

import { parseRoute, workspacePath } from "../src/web/client/router.ts";

test("parseRoute separates workspace prefix from page tail", () => {
  expect(parseRoute("/workspaces/ws-1/agents/serviceA")).toEqual({
    workspaceId: "ws-1",
    page: ["agents", "serviceA"],
  });
  expect(parseRoute("/workspaces/ws%202/messages/architect/serviceA")).toEqual({
    workspaceId: "ws 2",
    page: ["messages", "architect", "serviceA"],
  });
  expect(parseRoute("/settings/runtime")).toEqual({
    workspaceId: null,
    page: ["settings", "runtime"],
  });
  expect(parseRoute("/workspaces")).toEqual({
    workspaceId: null,
    page: ["workspaces"],
  });
});

test("workspacePath formats workspace and daemon-level paths", () => {
  expect(workspacePath("ws-1", "/agents/serviceA")).toBe("/workspaces/ws-1/agents/serviceA");
  expect(workspacePath("ws 2", "/settings/runtime")).toBe("/workspaces/ws%202/settings/runtime");
  expect(workspacePath(null, "/workspaces")).toBe("/workspaces");
  expect(workspacePath(null, "/agents")).toBe("/");
});
