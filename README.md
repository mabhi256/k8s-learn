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
| s10 | HPA | `HorizontalPodAutoscaler`, metrics-server, CPU/memory-based scaling, load test with `hey`, scale-up vs scale-down behavior; VPA covered conceptually (modes, HPA-vs-VPA conflict) with actual install deferred to s13 |
| s11 | Helm | chart anatomy (`Chart.yaml`, `values.yaml`, `templates/`, `_helpers.tpl`), package `users-api` as a chart, `helm install/upgrade/rollback`, replace s10's manual metrics-server install with `helm install` |
| s12 | LGTM observability | full LGTM stack via Helm: Mimir (long-term metrics, multi-tenant Prometheus-compatible TSDB), Loki (logs), Tempo + OpenTelemetry (traces), Grafana (UI); Prometheus reframed as the scraper that `remote_write`s to Mimir; Alloy for log shipping; instrument `users-api` and `notify-api` with `prom-client` + OTel SDK; CRDs: `ServiceMonitor`, `PrometheusRule`; Kustomize as a Helm post-renderer to patch fields the `kube-prometheus-stack` chart doesn't expose via `values.yaml` |
| s13 | Advanced HPA + VPA | VPA via Fairwinds Helm chart (right-sizes `resources.requests`, modes `Off` / `Recreate` / `InPlaceOrRecreate`), prometheus-adapter to register `custom.metrics.k8s.io`, capstone HPA scaling users-api on a scraped metric (e.g. `http_requests_per_second`) |
| s14 | Service mesh (sidecar) | Istio sidecar model, mTLS via a per-Pod Envoy, traffic shaping (canary, blue/green, app `api/v1` and `api/v2` side-by-side with weighted/header-based routing) via `VirtualService`/`DestinationRule`, circuit breaking; the per-Pod cost that motivates s22; Istio-vs-Linkerd comparison |
| s15 | Jobs + DaemonSets | batch, cron, per-node workloads; one-off Job (DB seed), CronJob (`pg_dump` backup), initContainer pattern for migrations (Flyway), DaemonSet anatomy (Alloy + node-exporter from s12 explained); initContainer vs standalone Job trade-off |
| s16 | Operators + CRDs | operator pattern (CRD = schema, CR = instance, operator = reconcile loop); CloudNativePG: `Cluster` CR, primary + replica HA failover (<10 s), continuous WAL archiving, PgBouncer, PodMonitor; migrate from s5 StatefulSet; using vs building operators |
| s17 | KEDA | `ScaledObject` CRD replaces prometheus-adapter + custom-metric HPA from s13; Prometheus, cron, PostgreSQL, SQS scalers; scale-to-zero; `ScaledJob` for batch; contrast with s13 setup |
| s18 | GitOps | ArgoCD, declarative deploys, drift detection + auto-revert (`selfHeal`), App of Apps pattern, sync waves + hooks (PreSync migration Job from s15), `ApplicationSet`; contrast push (CI/CD) vs pull (GitOps) |
| s19 | Security hardening | External Secrets Operator (Fake provider locally → Vault/AWS SM in prod), Pod Security Standards (`restricted` profile, `enforce`/`audit`/`warn` modes), Kyverno (validate/mutate/generate), egress NetworkPolicy (default-deny + allowlist + DNS), Trivy (static image scanning), Falco (runtime syscall threat detection) |
| s20 | Resilience | PDB (`minAvailable`, VPA/drain interaction; closes the s5 Postgres PDB gap), ResourceQuota, LimitRange, PriorityClass (eviction order under pressure), Velero backup + restore |
| s21 | Advanced Scheduling | nodeSelector, node affinity (`requiredDuringScheduling` / `preferredDuringScheduling`), pod anti-affinity for replica spread across failure domains, taints + tolerations for dedicated nodes, topology spread constraints |
| s22 | Ambient mesh + Gateway API | Istio ambient mode: per-node `ztunnel` (L4 mTLS, HBONE) replaces sidecars, opt-in per-namespace **waypoint** for L7; migrate s14 off sidecars with no restart; Kubernetes **Gateway API** (`GatewayClass`/`Gateway`/`HTTPRoute`/`GRPCRoute`) replaces the frozen `Ingress` (s3) and `VirtualService`; GAMMA east-west routing; redo the s14 canary with weighted `HTTPRoute` `backendRefs` |
| s23 | Progressive delivery | Argo Rollouts, `Rollout` CRD as a drop-in for `Deployment`, canary with `AnalysisTemplate` querying Mimir (s12) for metric-gated promotion (error-rate SLO), automated rollback on breach, blue/green with preview Service; drives s22's Gateway API `HTTPRoute` weights via the Argo Rollouts Gateway API plugin; contrast with manual weight editing from s22 |
| s24 | EKS migration | IRSA, ALB controller, Karpenter, EBS CSI, ECR, Secrets Manager, human RBAC via IAM + EKS Access Entries (bind ClusterRoles to IAM users/groups) |

See [docs/](docs/) for per-stage notes with commands, reasoning, and what each concept teaches.

---

## Local vs cloud

Everything from **s0–s23 runs entirely on [kind](https://kind.sigs.k8s.io/) with open-source tools. s24 is the only stage that requires AWS**

| AWS service                    | Local equivalent used in earlier stages          |
| ------------------------------ | ------------------------------------------------ |
| ALB                            | nginx-ingress (s3) → Gateway API (s22)           |
| NLB (LoadBalancer service)     | Cloud Provider KIND: Postgres (s5), gRPC (s6)    |
| ACM (TLS certs)                | cert-manager + self-signed CA (s4)               |
| RDS                            | Postgres StatefulSet + PVC (s5)                  |
| ElastiCache                    | Redis Deployment, if/when added                  |
| ECR                            | `kind load docker-image` (s1+)                   |
| Secrets Manager                | External Secrets + Vault or Sealed Secrets (s19) |
| EBS / EFS CSI                  | local-path-provisioner (built into kind, s5)     |
| Route53                        | `/etc/hosts` entry (s3)                          |
| CloudWatch Logs/Metrics        | Mimir + Loki via Grafana (s12)                   |
| X-Ray (tracing)                | Tempo + OpenTelemetry Collector (s12)            |
| IAM Roles for ServiceAccounts  | no local equivalent; cloud-only concept (s24)    |
| Karpenter / Cluster Autoscaler | no local equivalent; kind nodes are static (s24) |

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
