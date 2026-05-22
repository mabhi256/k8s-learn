import * as grpc from '@grpc/grpc-js';
// 1. Import generated proto files
import { NotificationRequest, NotificationResponse, NotifyService, actionToJSON } from '../generated/notify';

// 2. Implement your handler matching the contract
function sendNotification(
    call: grpc.ServerUnaryCall<NotificationRequest, NotificationResponse>,
    callback: grpc.sendUnaryData<NotificationResponse>,
) {
    const {userId, email, action} = call.request;
    console.log(`received user_id=${userId} email=${email} action=${actionToJSON(action)}`)
    callback(null, {ok: true})
}

// 3. Pass the generated ServiceDescription and your handler implementation
const server = new grpc.Server();
server.addService(NotifyService, { sendNotification });

const PORT = process.env.PORT || "50051";
server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
    console.error("bind failed:", err);
    process.exit(1);
  }
  console.log(`notify-api listening on :${port}`);
});


function shutdown() {
  console.log("...shutting down");
  server.tryShutdown(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
