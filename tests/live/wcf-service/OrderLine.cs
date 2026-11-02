using System.Runtime.Serialization;

namespace Shop;

[DataContract]
public class OrderLine
{
    [DataMember]
    public string Product { get; set; } = "";

    [DataMember]
    public int Quantity { get; set; }
}
