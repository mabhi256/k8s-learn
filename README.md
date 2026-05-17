# k8s-learn

A hands-on Kubernetes learning project. Each stage introduces one new concept and is tagged in git so you can checkout any point in the journey.

```text
s0   Plain Docker          - app + db via docker compose, no k8s
s1   Pod basics            - run a single pod, learn lifecycle and probes
s2   Deployment + Service  - replicas, rolling updates, ClusterIP, ConfigMaps/Secrets, resource requests/limits
s3   Ingress               - HTTP routing via nginx-ingress, host + path rules
s4   TLS                   - cert-manager, self-signed ClusterIssuer, HTTPS termination at the ingress
s5   StatefulSet + PV      - Postgres in-cluster, mirrors RDS; PVC, pod identity, anti-affinity for replica spread
s6   Multi-service         - inter-service calls, NetworkPolicy, RBAC, HPA
s7   Helm + observability  - Helm chart, Prometheus, Grafana, Loki
s8   Service mesh          - Istio or Linkerd, mTLS, traffic shaping, circuit breaking
s9   Jobs + DaemonSets     - batch, cron, per-node workloads, init/sidecar patterns
s10  KEDA                  - event-driven autoscaling, scale-to-zero, cron/queue/Prometheus scalers
s11  GitOps                - ArgoCD, declarative deploys, drift detection
s12  Security hardening    - External Secrets, Pod Security Standards, Kyverno, Trivy
s13  Resilience            - PDB, ResourceQuota, LimitRange, Velero backups, scheduling (nodeSelector, affinity, taints/tolerations, topology spread)
s14  Operators + CRDs      - build a tiny operator with kubebuilder
s15  EKS migration         - IRSA, ALB controller, Karpenter, EBS CSI, ECR, Secrets Manager
```

See [docs/](docs/) for per-stage notes with commands, reasoning, and what each concept teaches.

---

## Local vs cloud

Everything from **s0–s14 runs entirely on [kind](https://kind.sigs.k8s.io/) with open-source tools.** No AWS account, no free-tier juggling. **s15 is the only stage that requires AWS** — its whole point is swapping the local equivalents below for AWS-managed counterparts and learning the cloud-specific glue (IRSA, ALB controller, Karpenter, etc.). Building the operator (s14) is also done locally, then migrated alongside everything else in s15.

| AWS service                    | Local equivalent used in earlier stages          |
| ------------------------------ | ------------------------------------------------ |
| ALB / NLB                      | nginx-ingress (s3)                               |
| ACM (TLS certs)                | cert-manager + self-signed CA (s4)               |
| RDS                            | Postgres StatefulSet + PVC (s5)                  |
| ElastiCache                    | Redis Deployment, if/when added                  |
| ECR                            | `kind load docker-image` (s1+)                   |
| Secrets Manager                | External Secrets + Vault or Sealed Secrets (s12) |
| EBS / EFS CSI                  | local-path-provisioner (built into kind, s5)     |
| Route53                        | `/etc/hosts` entry (s3)                          |
| CloudWatch Logs/Metrics        | Prometheus + Grafana + Loki (s7)                 |
| IAM Roles for ServiceAccounts  | no local equivalent; cloud-only concept (s15)    |
| Karpenter / Cluster Autoscaler | no local equivalent; kind nodes are static (s15) |

The migration to EKS is therefore mostly a config swap (ingress class, storage class, image registry, secret backend) plus the AWS-specific identity and node-scaling pieces that have no kind analogue.

---

## App: users-api

A minimal Express + Postgres CRUD service used throughout all stages. A static frontend is served on port **8080**.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Liveness check |
| GET | `/users` | List all users |
| GET | `/users/:id` | Get one user |
| POST | `/users` | Create a user |
| DELETE | `/users/:id` | Delete a user |

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
