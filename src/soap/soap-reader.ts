import type { SoapFault } from './soap-fault';

const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

/** Reads XML as plain values: text, `null` for `i:nil`, objects, and arrays for repeated items and `lists`. */
export class SoapReader {
  constructor(private readonly lists: Readonly<Record<string, string>>) {}

  value(element: Element): unknown {
    if (element.getAttributeNS(XSI, 'nil') === 'true') return null;
    const children = Array.from(element.children);
    if (Object.hasOwn(this.lists, element.localName)) return children.map((c) => this.value(c));
    if (children.length === 0) return element.textContent ?? '';
    if (children.length > 1 && children.every((c) => c.localName === children[0].localName)) return children.map((c) => this.value(c));
    const row: Record<string, unknown> = {};
    for (const child of children) row[child.localName] = this.value(child);
    return row;
  }

  /** SOAP 1.2 (`Code`, `Reason`, `Detail`) and SOAP 1.1 (`faultcode`, `faultstring`, `detail`). */
  fault(element: Element): SoapFault {
    const code = childNamed(element, 'Code');
    const codeText = code ? childNamed(code, 'Value')?.textContent : childNamed(element, 'faultcode')?.textContent;
    const subcode = lastSubcode(code);
    const reason = childNamed(element, 'Reason');
    const message = (reason ? childNamed(reason, 'Text') : childNamed(element, 'faultstring'))?.textContent ?? '';
    const detail = childNamed(element, 'Detail') ?? childNamed(element, 'detail');
    const fault: SoapFault = { code: withoutPrefix(codeText ?? ''), message: message.trim() };
    if (subcode) fault.subcode = subcode;
    if (detail) fault.detail = this.value(detail);
    return fault;
  }
}

export function childNamed(element: Element, localName: string): Element | undefined {
  return Array.from(element.children).find((c) => c.localName === localName);
}

function lastSubcode(code: Element | undefined): string | undefined {
  let subcode: string | undefined;
  for (let at = code && childNamed(code, 'Subcode'); at; at = childNamed(at, 'Subcode')) {
    const value = childNamed(at, 'Value')?.textContent;
    if (value) subcode = withoutPrefix(value);
  }
  return subcode;
}

function withoutPrefix(name: string): string {
  return name.trim().replace(/^.*:/, '');
}
