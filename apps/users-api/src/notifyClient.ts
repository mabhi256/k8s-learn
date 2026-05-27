import * as grpc from "@grpc/grpc-js";
import { trace } from "@opentelemetry/api";
import pino from "pino";
import { Action, NotificationRequest, NotifyClient } from '../generated/notify.js';

const logger = pino({
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
        const ctx = trace.getActiveSpan()?.spanContext();
        return ctx ? { trace_id: ctx.traceId } : {};
    },
});

function grpcLogger(
    options: grpc.InterceptorOptions,
    nextCall: (options: grpc.InterceptorOptions) => any,
): grpc.InterceptingCall {
    const start = Date.now();
    return new grpc.InterceptingCall(nextCall(options), {
        start(metadata, listener, next) {
            next(metadata, {
                onReceiveMetadata(md, next) { next(md); },
                onReceiveMessage(message, next) { next(message); },
                onReceiveStatus(status, next) {
                    logger.info(
                        {
                            protocol: "grpc",
                            direction: "send",
                            method: options.method_definition.path,
                            code: grpc.status[status.code],
                            ms: Date.now() - start,
                        },
                        "grpc",
                    );
                    next(status);
                },
            });
        },
    });
}

const host = process.env.NOTIFY_HOST || "notify-api"
const port = process.env.NOTIFY_PORT || "50051"
const target = `${host}:${port}`;
const client = new NotifyClient(target, grpc.credentials.createInsecure(), {
    interceptors: [grpcLogger],
});

export function notify(userId: number, email: string, action: Action) {
  const request = NotificationRequest.create({userId, email, action});
  return new Promise((resolve, reject) => {
    client.sendNotification(
      request,
      (err, resp) => (err ? reject(err) : resolve(resp))
    );
  });
}
