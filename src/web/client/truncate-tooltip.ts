export function escapeTruncateAttr(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch] || ch));
}

export function truncatedAttrs(text: unknown): string {
  return 'data-truncate-tip="' + escapeTruncateAttr(text) + '"';
}

type TruncateFallbackOptions = {
  document?: Document;
  delayMs?: number;
  isStyledTipReady?: () => boolean;
  setTimeoutFn?: (handler: () => void, delay: number) => unknown;
};

export function installTruncateTitleFallback(opts: TruncateFallbackOptions = {}): unknown {
  const doc = opts.document ?? document;
  const delay = opts.delayMs ?? 200;
  const isStyledTipReady = opts.isStyledTipReady ?? (() => doc.documentElement?.dataset.truncateTipController === "ready");
  const setTimer = opts.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  return setTimer(() => {
    if (isStyledTipReady()) return;
    doc.querySelectorAll<HTMLElement>('[data-truncate-tip]').forEach(el => {
      const tip = el.dataset.truncateTip || el.getAttribute('data-truncate-tip') || '';
      if (tip && !el.getAttribute('title')) el.setAttribute('title', tip);
    });
  }, delay);
}
