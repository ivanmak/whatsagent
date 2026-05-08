export const INITIAL_STATE_PLACEHOLDER = "__WHATSAGENT_INITIAL_STATE__";

export function escapeForScriptContext(json: string): string {
  return json.replace(/[<>&\u2028\u2029]/g, (ch) => {
    switch (ch) {
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "&": return "\\u0026";
      case "\u2028": return "\\u2028";
      case "\u2029": return "\\u2029";
      default: return ch;
    }
  });
}

export function renderWebShellClientScript(clientBundle: string, initialState: string): string {
  return `<script>\n${clientBundle.replace(INITIAL_STATE_PLACEHOLDER, escapeForScriptContext(initialState))}\n  </script>`;
}
