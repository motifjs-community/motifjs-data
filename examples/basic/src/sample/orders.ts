export type Order = { id: number; customer: string; city: string; amount: number; date: string };

const CUSTOMERS = ['Ayşe Yılmaz', 'İsmail Işık', 'Zeynep Kaya', 'Ömer Çelik', 'Ada Lovelace', 'Grace Hopper', 'Ilgaz Demir', 'Şule Aydın'];
const CITIES = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Berlin', 'Oslo'];

/** Orders spread over customers, cities and the days of 2024. */
export function makeOrders(count: number): Order[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    customer: CUSTOMERS[(i * 7) % CUSTOMERS.length],
    city: CITIES[(i * 13) % CITIES.length],
    amount: ((i * 7919) % 100_000) / 100,
    date: new Date(2024, 0, 1 + (i % 365)).toISOString().slice(0, 10),
  }));
}
