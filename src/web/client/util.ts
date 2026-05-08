export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? singular + 's');
}

export function stripAnsi(text: string): string {
  return String(text || '')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[PX^_][\s\S]*?\u001b\\/g, '')
    .replace(/\u001b./g, '');
}
