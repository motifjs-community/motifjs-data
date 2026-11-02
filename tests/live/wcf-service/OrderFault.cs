using System.Runtime.Serialization;

namespace Shop;

// Detail of a fault: `Kind` is Invalid, Conflict or NotFound; `Field` names the rejected field.
[DataContract]
public class OrderFault
{
    [DataMember]
    public string Kind { get; set; } = "";

    [DataMember]
    public string? Field { get; set; }
}
