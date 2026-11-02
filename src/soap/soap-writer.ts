const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const ARRAYS = 'http://schemas.microsoft.com/2003/10/Serialization/Arrays';
// Item names of lists of plain values in the DataContract format.
const PLAIN_TYPES = new Set(['string', 'int', 'long', 'short', 'byte', 'decimal', 'double', 'float', 'boolean', 'dateTime', 'guid', 'char']);

/** Writes an operation and its arguments the way WCF's DataContractSerializer or XmlSerializer reads them. */
export class SoapWriter {
  constructor(
    private readonly settings: {
      dataContract: boolean;
      dataNamespace: string;
      firstFields: readonly string[];
      lists: Readonly<Record<string, string>>;
    },
  ) {}

  operation(name: string, namespace: string, args: Record<string, unknown>): string {
    let attributes = `xmlns="${escapeXml(namespace)}" xmlns:i="${XSI}"`;
    if (this.settings.dataContract) attributes += ` xmlns:d="${escapeXml(this.settings.dataNamespace)}" xmlns:arr="${ARRAYS}"`;
    const params = Object.entries(args).map(([param, value]) => this.element(param, '', value));
    return `<${name} ${attributes}>${params.join('')}</${name}>`;
  }

  private element(name: string, prefix: string, value: unknown): string {
    const tag = prefix + name;
    if (value === undefined) return '';
    if (value === null) return `<${tag} i:nil="true"/>`;
    if (Array.isArray(value)) {
      const item = this.settings.lists[name];
      if (!item) throw new TypeError(`"${name}" is a list; give the name of its items in the lists option`);
      const itemPrefix = !this.settings.dataContract ? '' : PLAIN_TYPES.has(item) ? 'arr:' : 'd:';
      return `<${tag}>${value.map((v) => this.element(item, itemPrefix, v)).join('')}</${tag}>`;
    }
    if (typeof value === 'object' && !(value instanceof Date)) {
      const fieldPrefix = this.settings.dataContract ? 'd:' : '';
      const fields = this.ordered(value as Record<string, unknown>).map(([field, v]) => this.element(field, fieldPrefix, v));
      return `<${tag}>${fields.join('')}</${tag}>`;
    }
    return `<${tag}>${escapeXml(plainText(value))}</${tag}>`;
  }

  // A field out of order is skipped by DataContractSerializer without an error.
  private ordered(row: Record<string, unknown>): [string, unknown][] {
    const first = this.settings.firstFields;
    const rest = Object.entries(row).filter(([field]) => !first.includes(field));
    if (this.settings.dataContract) rest.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return [...first.filter((field) => field in row).map((field): [string, unknown] => [field, row[field]]), ...rest];
  }
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function plainText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && !Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value > 0 ? 'INF' : '-INF';
  return String(value);
}
