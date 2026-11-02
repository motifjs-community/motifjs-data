/** A SOAP fault. `code` has no prefix: `Client` / `Sender` (the request was rejected), `Server` / `Receiver` … */
export interface SoapFault {
  code: string;
  /** SOAP 1.2: the most specific subcode. */
  subcode?: string;
  message: string;
  /** The detail as plain values, read like a result. */
  detail?: unknown;
}
