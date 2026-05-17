# k8s-learn

A hands-on Kubernetes learning project. Each stage introduces one new concept and is tagged in git so you can checkout any point in the journey.

```text
s0  Plain Docker          - app + db via docker compose, no k8s
s1  Pod basics            - run a single pod, learn lifecycle and probes
s2  Deployment + Service  - replicas, rolling updates, ClusterIP, ConfigMaps/Secrets
s3  Ingress               - HTTP routing via nginx-ingress
s4  StatefulSet + PV      - Postgres in-cluster, mirrors RDS; learn PVC and pod identity
s5  Multi-service         - inter-service calls, NetworkPolicy, RBAC, HPA
s6  Helm + observability  - Helm chart, Prometheus, Grafana, Loki; ready for EKS Fargate
```

See [docs/](docs/) for per-stage notes with commands, reasoning, and what each concept teaches.

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

## Navigating stages

```bash
git tag          # list all stage tags
git checkout s1  # jump to a stage
git checkout -   # go back to where you were
```
