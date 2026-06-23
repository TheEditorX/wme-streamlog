/**
 * Returns the actual active window object, prioritizing unsafeWindow in Tampermonkey.
 */
export function getWazeWindow(): any {
  if (typeof (globalThis as any).unsafeWindow !== 'undefined') {
    return (globalThis as any).unsafeWindow;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  return globalThis;
}
