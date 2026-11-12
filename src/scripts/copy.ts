export interface CopyDeps {
  /** navigator.clipboard (only exists on https:// pages and localhost). */
  clipboard?: { writeText(text: string): Promise<void> };
  /** Fallback for plain-http pages, e.g. select the field and call document.execCommand('copy'). */
  legacy?: () => boolean;
}

/** Copies text, trying the Clipboard API first and then the legacy fallback. Returns whether it worked. */
export async function copyText(text: string, deps: CopyDeps): Promise<boolean> {
  if (deps.clipboard) {
    try {
      await deps.clipboard.writeText(text);
      return true;
    } catch {
      /* permission denied or insecure context: try the fallback */
    }
  }
  try {
    return deps.legacy?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Did the user copy the whole link? True when the selection spans the entire field value. A partial selection
 * (say, half the token) must not count as having saved the link.
 */
export function coversWholeValue(selectionStart: number | null, selectionEnd: number | null, length: number): boolean {
  return length > 0 && selectionStart === 0 && selectionEnd === length;
}
