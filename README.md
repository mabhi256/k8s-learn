# k8s-learn

A hands-on Kubernetes learning project. Each stage introduces one new concept and is tagged in git so you can checkout any point in the journey.

| Stage | Name | Topics |
| ----- | ---- | ------ |
| s0 | Plain Docker | app + db via docker compose, no k8s |
| s1 | Pod basics | run a single pod, learn lifecycle and probes |
| s2 | Deployment + Service | replicas, rolling updates, ClusterIP, ConfigMaps/Secrets, resource requests/limits |
| s3 | Ingress | HTTP routing via nginx-ingress, host + path rules |
| s4 | TLS | cert-manager (introduces CRDs: `Certificate`, `ClusterIssuer`), self-signed ClusterIssuer, HTTPS termination at the ingress, HTTP→HTTPS redirect |
| s5 | StatefulSet + PV | Postgres in-cluster, mirrors RDS; PVC, pod identity, anti-affinity for replica spread; LoadBalancer service for external DB client access (pgAdmin/DBeaver) |
| s6 | Multi-service | second workload (`notify-api`), inter-service calls (gRPC over ClusterIP), external gRPC via LoadBalancer |
| s7 | NetworkPolicy | swap kindnet for Calico, default-deny ingress, explicit allow rules for each flow (frontend→users-api, users-api→postgres, users-api→notify-api, ext→notify-api) |
| s8 | ServiceAccounts | per-workload `ServiceAccount`, `automountServiceAccountToken: false` to remove the API-server token attack surface (AuthN side) |
| s9 | RBAC | `Role` / `ClusterRole` / `RoleBinding` / `ClusterRoleBinding`, human access via x509 client certs on kind (`CN=alice/O=devs` bound to built-in `view`), `resourceNames` gotcha (AuthZ side) |
| s10 | HPA | `HorizontalPodAutoscaler`, metrics-server, CPU/memory-based scaling, load test with `hey`, scale-up vs scale-down behavior; VPA covered conceptually (modes, HPA-vs-VPA conflict) with actual install deferred to s12 |
| s11 | Helm + observability | Helm chart, Prometheus + Grafana (metrics, via CRDs: `ServiceMonitor`, `PrometheusRule`), Loki (logs), Tempo + OpenTelemetry (tracing) |
| s12 | Advanced autoscaling | VPA via Fairwinds Helm chart (right-sizes `resources.requests`, modes `Off` / `Recreate` / `InPlaceOrRecreate`), prometheus-adapter to register `custom.metrics.k8s.io`, capstone HPA scaling users-api on a scraped metric (e.g. `http_requests_per_second`) |
| s13 | Service mesh | Istio or Linkerd, mTLS, traffic shaping (canary, blue/green, app `api/v1` and `api/v2` running side-by-side with weighted/header-based routing), circuit breaking |
| s14 | Jobs + DaemonSets | batch, cron, per-node workloads, init/sidecar patterns (Flyway DB migrations via initContainer or pre-deploy Job; `pg_dump` CronJob for the s5 Postgres StatefulSet) |
| s15 | KEDA | event-driven autoscaling, scale-to-zero, cron/queue/Prometheus scalers; contrast `ScaledObject` against the vanilla HPA + prometheus-adapter setup from s12 (why KEDA exists: scale-to-zero, multi-trigger, built-in SQS/Kafka/cron scalers without Prometheus in the middle) |
| s16 | GitOps | ArgoCD, declarative deploys, drift detection |
| s17 | Security hardening | External Secrets, Pod Security Standards, Kyverno (policy engine), Trivy (image scanning), Falco (runtime threat detection) |
| s18 | Resilience | PDB (incl. the Postgres PDB flagged in s5), ResourceQuota, LimitRange, Velero backups, scheduling (nodeSelector, affinity, taints/tolerations, topology spread) |
| s19 | Operators + CRDs | build a tiny operator with kubebuilder |
| s20 | EKS migration | IRSA, ALB controller, Karpenter, EBS CSI, ECR, Secrets Manager, human RBAC via IAM + EKS Access Entries (bind ClusterRoles to IAM users/groups) |

See [docs/](docs/) for per-stage notes with commands, reasoning, and what each concept teaches.

---

## Local vs cloud

Everything from **s0–s19 runs entirely on [kind](https://kind.sigs.k8s.io/) with open-source tools. s20 is the only stage that requires AWS**

| AWS service                    | Local equivalent used in earlier stages          |
| ------------------------------ | ------------------------------------------------ |
| ALB                            | nginx-ingress (s3)                               |
| NLB (LoadBalancer service)     | Cloud Provider KIND: Postgres (s5), gRPC (s6)    |
| ACM (TLS certs)                | cert-manager + self-signed CA (s4)               |
| RDS                            | Postgres StatefulSet + PVC (s5)                  |
| ElastiCache                    | Redis Deployment, if/when added                  |
| ECR                            | `kind load docker-image` (s1+)                   |
| Secrets Manager                | External Secrets + Vault or Sealed Secrets (s17) |
| EBS / EFS CSI                  | local-path-provisioner (built into kind, s5)     |
| Route53                        | `/etc/hosts` entry (s3)                          |
| CloudWatch Logs/Metrics        | Prometheus + Grafana + Loki (s11)                |
| X-Ray (tracing)                | Tempo + OpenTelemetry Collector (s11)            |
| IAM Roles for ServiceAccounts  | no local equivalent; cloud-only concept (s20)    |
| Karpenter / Cluster Autoscaler | no local equivalent; kind nodes are static (s20) |

The migration to EKS is therefore mostly a config swap (ingress class, storage class, image registry, secret backend) plus the AWS-specific identity and node-scaling pieces that have no kind analogue.

---

## Application stack

The project runs four services. They are introduced one at a time across the stages.

### users-api (s1+)

A Node.js + Express REST API. Talks to Postgres over TCP. The primary workload used in every stage.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Readiness + DB check |
| GET | `/live` | Liveness (no DB hit) |
| GET | `/users` | List all users |
| GET | `/users/:id` | Get one user |
| POST | `/users` | Create a user |
| DELETE | `/users/:id` | Delete a user |

After a create or delete, users-api fires a best-effort gRPC call to notify-api (s6+).

### frontend (s2+)

A static single-page app served by nginx. Talks only to users-api via the ingress (`/api` prefix). No direct backend access.

### Postgres (s5+)

Runs as a `StatefulSet` inside the cluster with a `PersistentVolumeClaim` per pod. Introduced in s5 to replace the docker-compose Postgres from s0.

### notify-api (s6+)

A Node.js gRPC server. Receives a notification from users-api on every user create or delete and logs it. No database, no state.

| RPC | Request fields | Description |
| --- | --- | --- |
| `Notify/SendNotification` | `user_id`, `email`, `action` | Log a user lifecycle event |

Exposed inside the cluster on port `50051` (ClusterIP) and externally via a LoadBalancer Service for testing with `grpcurl`.

---

## Prerequisites

Check each tool is on your PATH before starting:

```bash
node    --version           # to run the app locally (s0)
docker  version             # container runtime
kind    version             # local k8s clusters in docker
kubectl version --client    # k8s CLI
helm    version             # used from s7 onward
```

---

## Navigating stages

```bash
git tag          # list all stage tags
git checkout s1  # jump to a stage
git checkout -   # go back to where you were
```

> **Note:** From s5 onward, a multi-node kind cluster is required to observe node-topology concepts (anti-affinity, DaemonSets, topology spread, PDB).
