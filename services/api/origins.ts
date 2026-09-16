function isLoopbackOrigin(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === value
      && (url.protocol === 'http:' || url.protocol === 'https:')
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

// One local API serves Vite's main checkout and dynamically assigned worktree ports.
// A deployed AUTH_ORIGIN continues to trust only its exact configured origin.
export function allowsOrigin(configured: string, incoming: string | null | undefined): boolean {
  return incoming === configured || (isLoopbackOrigin(configured) && isLoopbackOrigin(incoming));
}
