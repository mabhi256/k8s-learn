# Fresh start — rebuild the cluster from zero to s15

> Full rebuild runbook: from no cluster to the **s15** state (Istio mesh + Jobs/CronJobs),
> **without Mimir**. Run everything from the repo root.

**Before you rebuild:** if you only restarted your PC, you do **not** need this. A reboot
just stops the kind containers; it doesn't destroy them. Bring the cluster back with:

```bash
docker start $(docker ps -aq --filter "name=demo")
kubectl get nodes   # wait ~30s
```

Only follow the steps below if `kind get clusters` shows nothing, or the cluster is broken
beyond repair.

---

## ⚠️ Step 0 — WSL prerequisites (do once per WSL instance)

### inotify limits

`kubectl logs -f`, Helm watches, and file-system observers exhaust WSL's default inotify limit (128 instances) quickly with a kind + Istio cluster. Fix it once and persist it:

```bash
sudo sysctl fs.inotify.max_user_instances=512
sudo sysctl fs.inotify.max_user_watches=1048576
echo "fs.inotify.max_user_instances=512"   | sudo tee -a /etc/sysctl.conf
echo "fs.inotify.max_user_watches=1048576" | sudo tee -a /etc/sysctl.conf
```

If already set from a previous session, skip — the `/etc/sysctl.conf` entries survive reboots.

### Clear stale loopback aliases FIRST

`cloud-provider-kind` adds each LoadBalancer IP as an alias on WSL's loopback interface.
If a previous session left these behind (or a `cloud-provider-kind` is already running), the
kernel treats those `172.x` IPs as local and kube-proxy's DNAT never fires — in-cluster LB
traffic silently dead-ends. **Check and remove them before anything else:**

```bash
# List any 172.x aliases stuck on loopback:
ip addr show lo | grep '172\.'
# inet 172.18.0.4/32 scope global lo
# inet 172.18.0.5/32 scope global lo

# Delete each one shown (repeat per IP):
sudo ip addr del 172.18.0.4/32 dev lo
sudo ip addr del 172.18.0.5/32 dev lo

# Confirm loopback is clean:
ip addr show lo | grep '172\.'   # should print nothing
```

> `cloud-provider-kind` re-adds these on each reconcile. If LB traffic breaks mid-session,
> re-run the `ip addr del` step — see [wsl-browser-access.md](./wsl-browser-access.md) step 4.

---

## Step 1 — cloud-provider-kind (dedicated WSL terminal, leave running)

```bash
sudo KUBECONFIG=$HOME/.kube/config $(go env GOPATH)/bin/cloud-provider-kind
```

Without this, every `LoadBalancer` Service (ingress-nginx, postgres-lb, notify-api-lb) stays
`<pending>`.

---

## Step 2 — Create the cluster (Calico CNI, 3 nodes)

```bash
kind delete cluster --name demo
kind create cluster --config infra/kind-config.yaml
```

Nodes are `NotReady` until the CNI is installed — expected.

### Install Calico

Right after creation, the API server's `/openapi/v2` endpoint is flaky (no CNI → nodes
NotReady → aggregation layer unhealthy). `kubectl apply` downloads that schema for validation
and fails with `failed to download openapi: ... EOF`. Skip the validation — the manifest is
valid:

```bash
kubectl apply --validate=false \
  -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.1/manifests/calico.yaml

kubectl -n kube-system rollout status ds/calico-node --timeout=180s
kubectl get nodes   # all 3 should be Ready now
```

---

## Step 3 — Build & load images

```bash
docker build -t users-api:local-v3  apps/users-api      # v3 = /metrics + tracing (s12)
docker build -t notify-api:local-v2 apps/notify-api     # v2 = tracing (s12)
docker build -t frontend:local-v1   apps/frontend
kind load docker-image users-api:local-v3 notify-api:local-v2 frontend:local-v1 --name demo
```

---

## Step 4 — Cluster add-ons (ingress, cert-manager, metrics-server)

```bash
# nginx-ingress (cloud manifest → LoadBalancer via cloud-provider-kind)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
kubectl wait -n ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s

# cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl wait -n cert-manager --for=condition=Available deployment \
  --selector=app.kubernetes.io/instance=cert-manager --timeout=180s

# metrics-server (Helm; --kubelet-insecure-tls is baked into the values file)
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm install metrics-server metrics-server/metrics-server \
  -n kube-system -f helm/values/metrics-server.values.yaml
kubectl -n kube-system rollout status deploy/metrics-server --timeout=120s
```

---

## Step 5 — Observability, **no Mimir** (s12/s13)

> **Why this comes before the app tier:** the `users-api` chart renders a `ServiceMonitor`
> (CRD from kube-prometheus-stack) and a `VerticalPodAutoscaler` (CRD from the Fairwinds VPA
> chart) into the `lgtm` namespace. If those CRDs and the `lgtm` namespace don't exist yet,
> `helm install users-api` fails with *"no matches for kind ServiceMonitor / VerticalPodAutoscaler …
> ensure CRDs are installed first."* Installing this stack first creates both CRDs and the
> namespace, so the app tier installs cleanly with no flags.

`kube-prometheus-stack.values.yaml` has `mimir.enabled: false` by default, which drops the
`remoteWrite` block. So just skip installing Mimir and skip the `.mimir.values.yaml` overlay —
nothing else changes. Grafana will show a broken Mimir data-source icon; harmless.

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana              https://grafana.github.io/helm-charts
helm repo add open-telemetry       https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo add fairwinds-stable     https://charts.fairwinds.com/stable
helm repo update

kubectl create namespace lgtm

# Logs + traces backends (no mimir)
helm install loki  grafana/loki  -n lgtm -f helm/values/loki.values.yaml
helm install tempo grafana/tempo -n lgtm -f helm/values/tempo.values.yaml
helm install otel-collector open-telemetry/opentelemetry-collector \
  -n lgtm -f helm/values/otel-collector.values.yaml

# Prometheus + Grafana (mimir.enabled stays false → no remoteWrite).
# This installs the ServiceMonitor CRD the users-api chart needs.
helm install prom prometheus-community/kube-prometheus-stack \
  -n lgtm -f helm/values/kube-prometheus-stack.values.yaml

# Log shipper
helm install alloy grafana/alloy -n lgtm -f helm/values/alloy.values.yaml

# Custom-metric HPA adapter + VPA (s13).
# The Fairwinds vpa chart installs the VerticalPodAutoscaler CRD the users-api chart needs.
helm install prometheus-adapter prometheus-community/prometheus-adapter \
  -n lgtm -f helm/values/prometheus-adapter.values.yaml
helm install vpa fairwinds-stable/vpa \
  -n lgtm -f helm/values/vpa.values.yaml

# Grafana dashboards (if Mimir enabled, use it; else use Prometheus):
helm install dashboards helm/dashboards -n lgtm
#   With Mimir: add --set mimir.enabled=true
```

> **Minimal variant:** for just the canary dashboards (Prometheus/Grafana only, the s13 setup),

---

## Step 6 — App tier

```bash
# Postgres StatefulSet + secret/configmap/services (s5)
kubectl apply -f k8s/postgres/

# notify-api + frontend (raw manifests)
kubectl apply -f k8s/notify-api/
kubectl apply -f k8s/frontend/

# TLS issuers + cert, then ingress (s4)
kubectl apply -f k8s/tls/
kubectl apply -f k8s/ingress.yaml

kubectl rollout status statefulset/postgres
kubectl rollout status deploy/notify-api
kubectl rollout status deploy/frontend

# users-api via Helm (s11+) — chart wires HPA, ServiceMonitor, VPA, env from values.yaml.
# Works with no flags now that Step 5 installed the ServiceMonitor + VPA CRDs and the lgtm ns.
helm install users-api helm/users-api -n default
kubectl rollout status deploy/users-api
```

---

## Step 7 — NetworkPolicies (s7) — apply LAST in this tier

```bash
kubectl apply -f k8s/network-policies/
```

---

## Step 8 — Istio service mesh (s14)

```bash
# If istioctl isn't installed yet:
#   cd ~ && curl -L https://istio.io/downloadIstio | sh -
#   echo 'export PATH=$PATH:$HOME/istio-1.30.0/bin' >> ~/.bashrc && source ~/.bashrc
# istioctl install --set profile=demo -y

# Instead of: istioctl install
helm install istio-base istio/base -n istio-system --create-namespace
helm install istiod istio/istiod -n istio-system
helm install istio-ingressgateway istio/gateway -n istio-system

kubectl label namespace default istio-injection=enabled
kubectl rollout restart deploy/users-api deploy/notify-api deploy/frontend
kubectl rollout restart statefulset/postgres

```

---

## Step 9 — s15: seed the database + install backup CronJob

```bash
# Seed initial data (one-off Job — raw kubectl, not Helm)
kubectl apply -f k8s/jobs/db-seed.yaml
kubectl wait --for=condition=complete job/db-seed --timeout=60s
kubectl logs job/db-seed   # should show: INSERT 0 3

# Install the backup CronJob via Helm (lifecycle-tracked)
helm install db-backup helm/db-backup -n default
```

> **Prerequisite:** the `allow-ingress-postgres` NetworkPolicy (applied in Step 7) must allow
> `app=db-seed`. If you applied the NetworkPolicies before this fix was merged, re-apply:
> `kubectl apply -f k8s/network-policies/postgres.yaml`

---

## Step 10 — WSL browser access

Once everything is running, follow [wsl-browser-access.md](./wsl-browser-access.md) to reach
`https://demo.local` from a Windows browser (ingress IP, `/etc/hosts`, kindccm port, `netsh`
portproxy, CA trust). The loopback-alias removal in Step 0 above is the same step 4 in that
checklist — re-run it any time LB traffic stops working.

---

## Quick sanity checks

```bash
kubectl get pods -A | grep -vE 'Running|Completed'   # nothing unexpected pending/crashing
istioctl proxy-status                                # all SYNCED
curl -k https://demo.local/api/users                 # 200 / JSON (from WSL)
```
