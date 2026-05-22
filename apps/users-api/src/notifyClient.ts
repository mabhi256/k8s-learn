import * as grpc from "@grpc/grpc-js";
import { Action, NotificationRequest, NotifyClient } from '../generated/notify.js';

const host = process.env.NOTIFY_HOST || "notify-api"
const port = process.env.NOTIFY_PORT || "50051"
const target = `${host}:${port}`;
const client = new NotifyClient(target, grpc.credentials.createInsecure());

export function notify(userId: number, email: string, action: Action) {
  const request = NotificationRequest.create({userId, email, action});
  return new Promise((resolve, reject) => {
    client.sendNotification(
      request,
      (err, resp) => (err ? reject(err) : resolve(resp))
    );
  });
}
