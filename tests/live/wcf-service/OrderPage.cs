using System.Runtime.Serialization;

namespace Shop;

[DataContract]
public class OrderPage
{
    [DataMember]
    public List<Order> Items { get; set; } = [];

    [DataMember]
    public int Total { get; set; }
}
