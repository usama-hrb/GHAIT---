/**
 * Runs `work` holding a lock shared by every tab of the app (Web Locks API), so two tabs never
 * sync or refresh the session at the same time. Without the API (tests), it just runs.
 */
export async function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return work();
  return navigator.locks.request(name, work);
}
