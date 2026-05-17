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

## App: users-api

A minimal Express + Postgres CRUD service used throughout all stages.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Liveness check |
| GET | `/users` | List all users |
| GET | `/users/:id` | Get one user |
| POST | `/users` | Create a user |
| DELETE | `/users/:id` | Delete a user |

---

## s0 — Plain Docker

> **Tag:** `s0`
> Goal: verify the app and database work together before touching Kubernetes.

### Start

```bash
cd local
docker compose up -d --build
```

The API is available at `http://localhost:3000`.

### Check the API with curl

#### Health check

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok","db":true}`

#### Create a user

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'
```

#### List users

```bash
curl http://localhost:3000/users
```

#### Get a user by id

```bash
curl http://localhost:3000/users/1
```

#### Delete a user

```bash
curl -X DELETE http://localhost:3000/users/1
```

### Stop

```bash
docker compose down          # keep the postgres volume
docker compose down -v       # also delete the volume (fresh DB next start)
```

---

## Navigating stages

```bash
git tag          # list all stage tags
git checkout s1  # jump to a stage
git checkout -   # go back to where you were
```
