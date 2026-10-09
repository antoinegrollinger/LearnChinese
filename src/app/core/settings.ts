/* Small per-browser preferences in localStorage. It can be unavailable (private browsing): then
 * the setting is just not kept. */

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
