using CoreWCF;

namespace Shop;

[ServiceContract]
public interface IOrderService
{
    [OperationContract]
    List<Order> GetAllOrders();

    [OperationContract]
    OrderPage GetOrders(int skip, int take, string? sortBy, bool descending);

    [OperationContract]
    Order? GetOrder(int id);

    [OperationContract]
    [FaultContract(typeof(OrderFault))]
    Order AddOrder(Order order);

    [OperationContract]
    [FaultContract(typeof(OrderFault))]
    int AddOrderReturningId(Order order);

    [OperationContract]
    [FaultContract(typeof(OrderFault))]
    Order UpdateOrder(Order order);

    [OperationContract]
    [FaultContract(typeof(OrderFault))]
    void DeleteOrder(int id);

    [OperationContract]
    void Reset();
}
