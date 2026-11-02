import type { DataError } from '../errors/data-error';
import type { DataOperation } from '../errors/data-operation';
import type { HttpAdapterOptions } from '../http/http-adapter-options';
import type { SoapFault } from './soap-fault';
import type { SoapOperations } from './soap-operations';

export interface SoapAdapterOptions<T, K> extends HttpAdapterOptions<T> {
  /** The service address: `https://host/OrderService.svc`. */
  url: string;
  operations: SoapOperations<T, K>;
  /** The service namespace. Default `'http://tempuri.org/'`, the WCF default. */
  namespace?: string;
  /** The service contract (`IOrderService`), part of the default SOAP action. */
  contract?: string;
  /** Default `'1.1'` (WCF `basicHttpBinding`). */
  version?: '1.1' | '1.2';
  /** Adds WS-Addressing headers, for bindings that need them (WCF `wsHttpBinding` without security). */
  addressing?: boolean;
  /**
   * How the service reads objects. `'datacontract'` (WCF default): fields in `dataNamespace` and in
   * alphabetical order, lists of plain values in the arrays namespace. `'xml'` (ASMX, XmlSerializer):
   * everything in the service namespace, fields in the order given. Default `'datacontract'`.
   */
  serializer?: 'datacontract' | 'xml';
  /** Namespace of object fields: `http://schemas.datacontract.org/2004/07/<CLR namespace>`. Default: `namespace`. */
  dataNamespace?: string;
  /** Fields written before the others, in this order: the fields of a base class, which WCF reads first. */
  firstFields?: readonly string[];
  /**
   * Fields that are lists, with the element name of their items: `{ Lines: 'OrderLine', Tags: 'string' }`.
   * Writing a list needs it; reading uses it so that a list of one item or none stays a list.
   */
  lists?: Readonly<Record<string, string>>;
  /** XML for the envelope's `Header`, such as a security token. */
  soapHeader?: (operation: string) => string | undefined;
  /** Turns a fault into an error; nothing returned keeps the default (`Client` / `Sender` → `MJD202`, others → `MJD201`). */
  readFault?: (fault: SoapFault, operation: DataOperation) => DataError | void;
  /** Changes each row read from the service, after declared `number` and `boolean` fields (`Lines.Quantity` too) are converted. */
  readRow?: (row: Record<string, unknown>) => T;
}
