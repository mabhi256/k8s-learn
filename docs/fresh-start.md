# Fresh start — rebuild the cluster from zero to s14

> Full rebuild runbook: from no cluster to the **s14** state (Istio mesh + canary),
> **without Mimir**. Run everything from the repo root.

**Before you rebuild:** if you only restarted your machine, you do **not** need this. A reboot
just stops the kind containers; it doesn't destroy them. Bring the cluster back with:

```bash
docker start $(docker ps -aq --filter "name=demo")
kubectl get nodes   # wait ~30s
```

Only follow the steps below if `kind get clusters` shows nothing, or the cluster is broken
beyond repair.

---

## ⚠️ Step 0 — Clear stale loopback aliases FIRST (WSL only)

`cloud-provider-kind` adds each LoadBalancer IP as an alias on the loopback interface.
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
> re-run the `ip addr del` step — see Step 9 (loopback aliases) for details.

---

## Step 1 — Create the cluster (Calico CNI, 3 nodes)

```bash
sudo kind delete cluster --name demo
sudo kind create cluster --config infra/kind-config.yaml
```

> **kubeconfig:** `sudo kind create cluster` writes the kubeconfig into **root's** home
> (`/root/.kube/config`), not yours. Without this fix, `kubectl` falls back to the
> unauthenticated `localhost:8080` endpoint and fails with `connection refused`. Copy it now:
>
> ```bash
> sudo kind get kubeconfig --name demo > ~/.kube/config
> ```

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

## Step 2 — cloud-provider-kind (dedicated terminal, leave running)

```bash
sudo KUBECONFIG=$HOME/.kube/config $(go env GOPATH)/bin/cloud-provider-kind
```

Without this, every `LoadBalancer` Service (ingress-nginx, postgres-lb, notify-api-lb) stays
`<pending>`.

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

## If we want s14 canary
#helm upgrade users-api ./helm/users-api -n default \
#  --set canary.enabled=true \
#  --set istio.destinationRule.enabled=true \
#  --set istio.virtualService.enabled=true

```

---

## Step 9 — Browser access

On Linux the Docker bridge (`172.x.x.x`) is directly routable from the host — no port
proxying needed. Just point `/etc/hosts` at the ingress IP and open the browser.

### Get the ingress IP

Wait until the ingress-nginx controller has an external IP (may take 10–20 s after
cloud-provider-kind starts):

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# EXTERNAL-IP should be a 172.x.x.x address, not <pending>

INGRESS_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo $INGRESS_IP   # confirm non-empty before continuing
```

### Update /etc/hosts

```bash
grep -q "demo\.local" /etc/hosts \
  && sudo sed -i "s/.*demo\.local/$INGRESS_IP demo.local/" /etc/hosts \
  || echo "$INGRESS_IP demo.local" | sudo tee -a /etc/hosts
```

### Remove loopback aliases (same as Step 0 — re-run if curl breaks)

```bash
ip addr show lo | grep '172\.'
sudo ip addr del 172.18.0.3/32 dev lo   # repeat for each IP shown

# Verify traffic routes via the Docker bridge, not loopback:
ip route get $INGRESS_IP   # should show: dev br-<id>  not  dev lo
```

### Trust the root CA (one-time per cluster)

```bash
# Extract the CA cert:
kubectl get secret demo-root-ca-tls -n cert-manager \
  -o jsonpath='{.data.ca\.crt}' | base64 -d > /tmp/ca.crt

# Install system-wide (curl and most CLI tools will trust it after this):
sudo cp /tmp/ca.crt /usr/local/share/ca-certificates/demo-root-ca.crt
sudo update-ca-certificates
```

**Firefox/Chrome:** these browsers ignore the system CA store. Import separately:
Settings → search **Certificates** → **View Certificates** → **Authorities** → **Import**
→ select `/usr/local/share/ca-certificates/demo-root-ca.crt` → check "Trust this CA to identify websites" → OK → restart browser.

**Remove later with:**
```bash
sudo rm /usr/local/share/ca-certificates/demo-root-ca.crt
sudo update-ca-certificates
```

### Verify

```bash
curl https://demo.local/api/users   # 200 / JSON (no -k needed after CA trust)
```

Open `https://demo.local/` in your browser — padlock should be solid.

---

## Quick sanity checks

```bash
kubectl get pods -A | grep -vE 'Running|Completed'   # nothing unexpected pending/crashing
istioctl proxy-status                                # all SYNCED
curl https://demo.local/api/users                    # 200 / JSON
```

---

## After every cluster restart (quick reference)

| Step | When |
|------|------|
| Start cloud-provider-kind | Every terminal session |
| Get INGRESS_IP + update /etc/hosts | Every cluster start (IP may change) |
| Remove loopback aliases | Every cluster start; repeat if curl breaks |
| Check TLS cert (`kubectl get certificate -A`) | After cluster recreate |
| Trust CA system-wide + browser import | Once per cluster lifetime |

---

## Teardown — completely remove the stack

### 1 — Remove the kind cluster (destroys all workloads, PVs, and namespaces)

```bash
kind delete cluster --name demo
```

### 2 — Remove loopback aliases left by cloud-provider-kind

```bash
ip addr show lo | grep '172\.'
sudo ip addr del 172.18.0.4/32 dev lo   # repeat for each IP shown
```

### 3 — Remove /etc/hosts entry

```bash
sudo sed -i '/demo\.local/d' /etc/hosts
```

### 4 — Stop cloud-provider-kind

In the dedicated terminal where `cloud-provider-kind` is running, press `Ctrl-C`.

### 5 — Remove built Docker images (optional)

```bash
docker rmi users-api:local-v3 notify-api:local-v2 frontend:local-v1
```

### 6 — Verify everything is gone

```bash
kind get clusters                      # should be empty
docker ps -a | grep demo               # should print nothing
ip addr show lo | grep '172\.'         # should print nothing
```
