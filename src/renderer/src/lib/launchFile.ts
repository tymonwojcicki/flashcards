// A deck file the OS asked the installed web app to open (double-click on a .fdeck file).
// Set by the web entry via the File Handling API; consumed by the next deck import.
let pending: File | null = null
const listeners = new Set<() => void>()

export function setLaunchFile(f: File): void {
  pending = f
  for (const l of listeners) l()
}

export function hasLaunchFile(): boolean {
  return pending !== null
}

/** Returns the pending file and clears it. */
export function takeLaunchFile(): File | null {
  const f = pending
  pending = null
  return f
}

export function onLaunchFile(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
