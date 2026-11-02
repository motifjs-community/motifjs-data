/** One request inside a `$batch`. */
export interface BatchRequestPart {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}
