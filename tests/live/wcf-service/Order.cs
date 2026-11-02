using System.Runtime.Serialization;

namespace Shop;

[DataContract]
public class Order : Entity
{
    [DataMember]
    public string Customer { get; set; } = "";

    [DataMember]
    public decimal Amount { get; set; }

    [DataMember]
    public DateTime OrderDate { get; set; }

    [DataMember]
    public bool Shipped { get; set; }

    [DataMember]
    public string? Note { get; set; }

    [DataMember]
    public List<string> Tags { get; set; } = [];

    [DataMember]
    public List<OrderLine> Lines { get; set; } = [];

    // DataContractSerializer does not run constructors: a list that was not sent is null.
    public Order Copy() => new()
    {
        Id = Id,
        Version = Version,
        Customer = Customer,
        Amount = Amount,
        OrderDate = OrderDate,
        Shipped = Shipped,
        Note = Note,
        Tags = [.. Tags ?? []],
        Lines = [.. (Lines ?? []).Select(l => new OrderLine { Product = l.Product, Quantity = l.Quantity })],
    };
}
