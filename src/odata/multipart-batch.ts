import type { BatchRequestPart } from './batch-request-part';
import type { BatchResponsePart } from './batch-response-part';

/** A `multipart/mixed` `$batch` body. With `changeset` the requests go in one change set: all succeed or none. */
export function writeBatch(requests: readonly BatchRequestPart[], boundary: string, changeset?: string): string {
  const lines: string[] = [];
  const inner = changeset ?? boundary;
  if (changeset) lines.push(`--${boundary}`, `Content-Type: multipart/mixed; boundary=${changeset}`, '');
  requests.forEach((r, i) => {
    lines.push(`--${inner}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${i + 1}`, '');
    lines.push(`${r.method} ${r.url} HTTP/1.1`);
    for (const [name, value] of Object.entries(r.headers)) lines.push(`${name}: ${value}`);
    lines.push('', r.body ?? '');
  });
  if (changeset) lines.push(`--${changeset}--`);
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

/** The answers of a `multipart/mixed` `$batch` answer, change sets flattened, in order. */
export function readBatch(body: string, contentType: string): BatchResponsePart[] {
  const boundary = /boundary="?([^";,\s]+)"?/i.exec(contentType)?.[1];
  if (!boundary) throw new TypeError('the batch answer has no boundary');
  const answers: BatchResponsePart[] = [];
  for (const part of body.split(`--${boundary}`).slice(1)) {
    if (part.startsWith('--')) break;
    const { headers, content } = splitHead(part.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, ''));
    const type = headers.get('content-type') ?? '';
    if (/^multipart\/mixed/i.test(type)) {
      answers.push(...readBatch(content, type));
    } else {
      answers.push({ ...readResponse(content), contentId: headers.get('content-id') ?? undefined });
    }
  }
  return answers;
}

function readResponse(text: string): BatchResponsePart {
  const lineEnd = text.indexOf('\n');
  const statusLine = (lineEnd < 0 ? text : text.slice(0, lineEnd)).trim();
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/i.exec(statusLine);
  if (!status) throw new TypeError(`"${statusLine}" is not an HTTP status line`);
  const { headers, content } = splitHead(lineEnd < 0 ? '' : text.slice(lineEnd + 1));
  const isJson = /[/+]json\b/i.test(headers.get('content-type') ?? '');
  const body = content.trim() === '' ? null : isJson ? JSON.parse(content) : content;
  return { status: Number(status[1]), statusText: status[2], headers, body };
}

function splitHead(text: string): { headers: Headers; content: string } {
  const end = /\r?\n\r?\n/.exec(text);
  const head = end ? text.slice(0, end.index) : text;
  const headers = new Headers();
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return { headers, content: end ? text.slice(end.index + end[0].length) : '' };
}
