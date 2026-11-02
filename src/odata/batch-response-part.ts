/** One answer inside a `$batch` answer. */
export interface BatchResponsePart {
  contentId?: string;
  status: number;
  statusText: string;
  headers: Headers;
  /** Parsed JSON, text, or `null` when empty. */
  body: unknown;
}
