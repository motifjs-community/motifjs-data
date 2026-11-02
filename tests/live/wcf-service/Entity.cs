using System.Runtime.Serialization;

namespace Shop;

// Base class: DataContractSerializer reads its fields before those of the subclass.
[DataContract]
public class Entity
{
    [DataMember]
    public int Id { get; set; }

    [DataMember]
    public int Version { get; set; }
}
