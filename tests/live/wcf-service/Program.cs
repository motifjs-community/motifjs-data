using System.Text;
using CoreWCF;
using CoreWCF.Channels;
using CoreWCF.Configuration;
using CoreWCF.Description;
using Shop;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(Environment.GetEnvironmentVariable("WCF_URL") ?? "http://localhost:5190");
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddServiceModelServices();
builder.Services.AddServiceModelMetadata();
builder.Services.AddSingleton<OrderService>();
builder.Services.AddCors(cors => cors.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();
app.UseServiceModel(services =>
{
    services.AddService<OrderService>();
    // SOAP 1.1, as basicHttpBinding.
    services.AddServiceEndpoint<OrderService, IOrderService>(new BasicHttpBinding(), "/OrderService.svc");
    // SOAP 1.2 with WS-Addressing, as wsHttpBinding without security.
    var soap12 = new CustomBinding(new TextMessageEncodingBindingElement(MessageVersion.Soap12WSAddressing10, Encoding.UTF8), new HttpTransportBindingElement());
    services.AddServiceEndpoint<OrderService, IOrderService>(soap12, "/OrderService12.svc");
});
app.Services.GetRequiredService<ServiceMetadataBehavior>().HttpGetEnabled = true;
app.Run();
