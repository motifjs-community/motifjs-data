using CoreWCF;

namespace Shop;

[ServiceBehavior(InstanceContextMode = InstanceContextMode.Single, ConcurrencyMode = ConcurrencyMode.Multiple)]
public class OrderService : IOrderService
{
    private static readonly string[] Customers = ["Ayşe Yılmaz", "İsmail Işık", "Zeynep Kaya", "Ömer Çelik", "Ada Lovelace", "Grace Hopper"];
    private readonly object gate = new();
    private List<Order> orders = Seed();
    private int nextId = 100;

    public List<Order> GetAllOrders()
    {
        lock (gate) return [.. orders.Select(o => o.Copy())];
    }

    public OrderPage GetOrders(int skip, int take, string? sortBy, bool descending)
    {
        lock (gate)
        {
            IEnumerable<Order> sorted = sortBy switch
            {
                "Customer" => orders.OrderBy(o => o.Customer, StringComparer.Ordinal),
                "Amount" => orders.OrderBy(o => o.Amount),
                "OrderDate" => orders.OrderBy(o => o.OrderDate),
                _ => orders.OrderBy(o => o.Id),
            };
            if (descending) sorted = sorted.Reverse();
            var page = sorted.Skip(skip);
            if (take > 0) page = page.Take(take);
            return new OrderPage { Items = [.. page.Select(o => o.Copy())], Total = orders.Count };
        }
    }

    public Order? GetOrder(int id)
    {
        lock (gate) return orders.FirstOrDefault(o => o.Id == id)?.Copy();
    }

    public Order AddOrder(Order order)
    {
        Validate(order);
        lock (gate)
        {
            order.Id = nextId++;
            order.Version = 1;
            orders.Add(order.Copy());
            return order;
        }
    }

    public int AddOrderReturningId(Order order) => AddOrder(order).Id;

    public Order UpdateOrder(Order order)
    {
        Validate(order);
        lock (gate)
        {
            var at = orders.FindIndex(o => o.Id == order.Id);
            if (at < 0) throw Fault("NotFound", null, $"No order {order.Id}.");
            if (orders[at].Version != order.Version) throw Fault("Conflict", null, "The order was changed by someone else.");
            order.Version++;
            orders[at] = order.Copy();
            return order;
        }
    }

    public void DeleteOrder(int id)
    {
        lock (gate)
        {
            if (orders.RemoveAll(o => o.Id == id) == 0) throw Fault("NotFound", null, $"No order {id}.");
        }
    }

    public void Reset()
    {
        lock (gate)
        {
            orders = Seed();
            nextId = 100;
        }
    }

    private static void Validate(Order order)
    {
        if (string.IsNullOrWhiteSpace(order.Customer)) throw Fault("Invalid", "Customer", "Customer is required.");
        if (order.Amount < 0) throw Fault("Invalid", "Amount", "Amount must not be negative.");
    }

    private static FaultException<OrderFault> Fault(string kind, string? field, string message) =>
        new(new OrderFault { Kind = kind, Field = field }, new FaultReason(message));

    // 25 orders: lists of none, one and two items, empty notes, Turkish names.
    private static List<Order> Seed() =>
        [.. Enumerable.Range(1, 25).Select(i => new Order
        {
            Id = i,
            Version = 1,
            Customer = Customers[i % Customers.Length],
            Amount = i * 12.5m,
            OrderDate = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddDays(i * 3),
            Shipped = i % 3 == 0,
            Note = i % 4 == 0 ? null : $"Note {i}",
            Tags = [.. new[] { "new", "gift" }.Take(i % 3)],
            Lines = [.. Enumerable.Range(1, i % 3).Select(n => new OrderLine { Product = $"P{n}", Quantity = n * i })],
        })];
}
