import http from "http";
import * as grpc from "@grpc/grpc-js";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const register = new Registry();
collectDefaultMetrics({ register });

export const grpcRequestsTotal = new Counter({
  name: "grpc_requests_total",
  help: "Total gRPC requests received",
  labelNames: ["method", "code"] as const,
  registers: [register],
});

export const grpcRequestDuration = new Histogram({
  name: "grpc_request_duration_seconds",
  help: "gRPC request duration in seconds",
  labelNames: ["method", "code"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

export function grpcMetricsInterceptor(
  methodDescriptor: grpc.ServerMethodDefinition<any, any>,
  call: grpc.ServerInterceptingCallInterface,
): grpc.ServerInterceptingCall {
  const start = Date.now();
  return new grpc.ServerInterceptingCall(call, {
    sendStatus(status, next) {
      const code = grpc.status[status.code];
      grpcRequestsTotal.inc({ method: methodDescriptor.path, code });
      grpcRequestDuration.observe({ method: methodDescriptor.path, code }, (Date.now() - start) / 1000);
      next(status);
    },
  });
}

export function startMetricsServer(port = 9091) {
  http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    } else {
      res.writeHead(404).end();
    }
  }).listen(port);
}
