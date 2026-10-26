/**
 * Opt-in diagnostics for site adapters. Enable on a page with
 *   localStorage.setItem("kickdanmu:debug", "1")
 * and reload. Warnings that indicate a broken site integration (for example a
 * selector that no longer matches) are always printed, but only once per key.
 */
export class DebugLog {
  private static STORAGE_KEY = "kickdanmu:debug";
  private static PREFIX = "[KickDanmu]";

  private warnedKeys = new Set<string>();

  public constructor(private isEnabled: () => boolean) {}

  public static create(): DebugLog {
    return new DebugLog(() => {
      try {
        return localStorage.getItem(DebugLog.STORAGE_KEY) === "1";
      } catch (_error) {
        return false;
      }
    });
  }

  public info(scope: string, message: string, details?: unknown): void {
    if (!this.isEnabled()) {
      return;
    }
    if (details === undefined) {
      console.info(`${DebugLog.PREFIX}[${scope}] ${message}`);
    } else {
      console.info(`${DebugLog.PREFIX}[${scope}] ${message}`, details);
    }
  }

  public warnOnce(scope: string, key: string, message: string): void {
    let fullKey = `${scope}:${key}`;
    if (this.warnedKeys.has(fullKey)) {
      return;
    }
    this.warnedKeys.add(fullKey);
    console.warn(`${DebugLog.PREFIX}[${scope}] ${message}`);
  }

  public resetWarning(scope: string, key: string): void {
    this.warnedKeys.delete(`${scope}:${key}`);
  }
}

export let DEBUG_LOG = DebugLog.create();
