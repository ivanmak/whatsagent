import { join } from "node:path";

export async function buildClientBundle(opts: { dev?: boolean } = {}): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "main.ts")],
    target: "browser",
    sourcemap: opts.dev ? "inline" : "none",
  });

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Failed to build web client bundle${logs ? `:\n${logs}` : ""}`);
  }

  return await result.outputs[0]!.text();
}
