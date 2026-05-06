/**
 * Shared utilities for the AI Assistant controller modules.
 * Split from `aiAssistantController.ts` (S80, refactor pass D, S53 pattern).
 */

export function truncateTitle(text: string | null | undefined, max: number = 80): string | null {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
