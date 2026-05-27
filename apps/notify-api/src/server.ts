import "./tracing";

import * as grpc from '@grpc/grpc-js';
import { grpcMetricsInterceptor, startMetricsServer } from "./metrics";
import { context, propagation, trace } from "@opentelemetry/api";
import pino from "pino";
// 1. Import generated proto files
import { NotificationRequest, NotificationResponse, NotifyService, actionToJSON } from '../generated/notify';

const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
        level: (label) => ({ level: label }),
    },
    mixin() {
        const ctx = trace.getActiveSpan()?.spanContext();
        return ctx ? { trace_id: ctx.traceId } : {};
    },
});

// Shares the extracted traceId from the interceptor to the handler,
// since getActiveSpan() is unreliable until after onReceiveMetadata runs.
const callTraceId = new WeakMap<grpc.Metadata, string>();

// 2. Implement your handler matching the contract
function sendNotification(
    call: grpc.ServerUnaryCall<NotificationRequest, NotificationResponse>,
    callback: grpc.sendUnaryData<NotificationResponse>,
) {
    const {userId, email, action} = call.request;
    logger.debug({ userId, email, action: actionToJSON(action), trace_id: callTraceId.get(call.metadata) }, "received notification")
    callback(null, {ok: true})
}

function grpcLogger(
    methodDescriptor: grpc.ServerMethodDefinition<any, any>,
    call: grpc.ServerInterceptingCallInterface,
): grpc.ServerInterceptingCall {
    const start = Date.now();
    let traceId: string | undefined;
    return new grpc.ServerInterceptingCall(call, {
        start(next) {
            next({
                onReceiveMetadata(metadata, innerNext) {
                    // Extract W3C traceparent. The OTel span is created after this
                    // interceptor runs, so getActiveSpan() is unreliable here.
                    const carrier = metadata.getMap() as Record<string, string>;
                    const ctx = propagation.extract(context.active(), carrier);
                    traceId = trace.getSpan(ctx)?.spanContext()?.traceId;
                    if (traceId) callTraceId.set(metadata, traceId);
                    innerNext(metadata);
                },
            });
        },
        sendStatus(status, next) {
            const code = grpc.status[status.code];
            logger.info(
                {
                    protocol: "grpc",
                    direction: "recv",
                    method: methodDescriptor.path,
                    code,
                    ms: Date.now() - start,
                    trace_id: traceId,
                },
                "grpc",
            );
            next(status);
        },
    });
}

// 3. Pass the generated ServiceDescription and your handler implementation
const server = new grpc.Server({ interceptors: [grpcLogger, grpcMetricsInterceptor] });
server.addService(NotifyService, { sendNotification });

startMetricsServer(Number(process.env.METRICS_PORT ?? 9091));

const PORT = process.env.PORT || "50051";
server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        logger.error({ err }, "bind failed");
        process.exit(1);
    }
    logger.info(`notify-api listening on :${port}`);
});


function shutdown() {
    logger.info("...shutting down");
    server.tryShutdown(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
