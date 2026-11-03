export function normalizePixCopyPaste(value: string): string {
  return value.trim().replace(/^(?:https?:\/\/)+\s*/i, '');
}
