import { data } from '@motifx-community/data';

export const NORTHWIND = 'https://services.odata.org/V4/Northwind/Northwind.svc/';

export type NorthwindOrder = {
  OrderID: number;
  CustomerID: string;
  ShipName: string;
  ShipCity: string;
  ShipCountry: string;
  OrderDate: string;
  Freight: number;
  Customer?: { CompanyName: string };
};

export type NorthwindCustomer = { CustomerID: string; CompanyName: string; ContactName: string; City: string; Country: string };

/** Northwind's orders; it has no `$apply`, so summaries are computed in memory. */
export function northwindOrders() {
  return new data.ODataAdapter<NorthwindOrder, number>({
    url: `${NORTHWIND}Orders`,
    key: 'OrderID',
    locale: 'en-US',
    fields: { OrderDate: 'datetime', Freight: 'number' },
    timeoutMs: 20_000,
    retry: { retries: 2 },
  });
}

export function northwindCustomers() {
  return new data.ODataAdapter<NorthwindCustomer, string>({
    url: `${NORTHWIND}Customers`,
    key: 'CustomerID',
    locale: 'en-US',
    timeoutMs: 20_000,
    retry: { retries: 2 },
  });
}

export const money = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–');
export const day = (iso: unknown) => (typeof iso === 'string' ? iso.slice(0, 10) : '–');
