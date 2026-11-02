/** The full address; a relative one is resolved against the page. */
export function absoluteUrl(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).href;
  } catch {
    return url;
  }
}
