# WSL restart checklist

> Run these steps after every PC reboot or WSL restart to get `https://demo.local` working
> again. The cluster itself survives reboots; this just restarts the supporting processes.

---

## Step 0 — Bring the cluster back

A reboot stops the kind containers but doesn't destroy them:

```bash
docker start $(docker ps -aq --filter "name=demo")
kubectl get nodes   # wait ~30s, all 3 should be Ready
```

If `kind get clusters` shows nothing, the cluster is gone: follow
[fresh-start.md](./fresh-start.md) instead.

### inotify limits

`kubectl logs -f`, Helm watches, and file-system observers exhaust the Linux default inotify limit (128 instances) quickly with a kind + Istio cluster. Fix it once and persist it:

```bash
# Check the values
sudo sysctl fs.inotify.max_user_instances
sudo sysctl fs.inotify.max_user_watches

# persist inotify limits across reboots
echo "fs.inotify.max_user_instances=512"   | sudo tee -a /etc/sysctl.conf
echo "fs.inotify.max_user_watches=1048576" | sudo tee -a /etc/sysctl.conf
```

If already set from a previous session, skip: the `/etc/sysctl.conf` entries survive reboots.

---

## Step 1 — cloud-provider-kind (dedicated WSL terminal, leave running)

```bash
sudo KUBECONFIG=$HOME/.kube/config $(go env GOPATH)/bin/cloud-provider-kind
```

Without this, every `LoadBalancer` Service (ingress-nginx, postgres-lb, notify-api-lb) stays
`<pending>`.

---

## Step 2 — Clear stale loopback aliases

`cloud-provider-kind` adds each LoadBalancer IP as an alias on WSL's loopback interface.
If a previous session left these behind (or a `cloud-provider-kind` is already running), the
kernel treats those `172.x` IPs as local and kube-proxy's DNAT never fires: in-cluster LB
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
> re-run the `ip addr del` step.

---

## Step 3 — Get the ingress IP

Wait until the ingress-nginx controller has an external IP (may take 10-20 s after cloud-provider-kind starts):

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# EXTERNAL-IP should be a 172.x.x.x address, not <pending>

INGRESS_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo $INGRESS_IP   # confirm non-empty before continuing
```

---

## Step 4 — Update WSL /etc/hosts

```bash
# check if demo.local line exists                   
grep -q "demo\.local" /etc/hosts \
  # If yes, update it
  && sudo sed -i "s/.*demo\.local/$INGRESS_IP demo.local/" /etc/hosts \
  # else add line
  || echo "$INGRESS_IP demo.local" | sudo tee -a /etc/hosts
```

---

## Step 5 — Find the kindccm HTTPS port (WSL)

cloud-provider-kind creates `kindccm-*` containers that forward service ports to random high ports on `0.0.0.0`. The port changes every time the cluster is recreated.

Run in WSL (PowerShell's docker connects to a different daemon and won't see these containers):

```bash
docker ps | grep kindccm
# kindccm-xxxx   ... 0.0.0.0:32782->80/tcp, 0.0.0.0:32783->443/tcp ...
```

Look for the container with `->80/tcp` and `->443/tcp` (the ingress-nginx one. It won't have Istio ports like `15021`). Note the port before `->443/tcp` (e.g. `32783`).

---

## Step 6 — Update the port proxy (Admin PowerShell)

Windows port 443 -> kindccm HTTPS port from step 5. This proxy survives reboots but the target port changes on cluster recreation.

```powershell
# Remove old rule:
netsh interface portproxy delete v4tov4 listenport=443 listenaddress=127.0.0.1

# Add rule pointing at the current kindccm port (replace 32769 with your port):
netsh interface portproxy add v4tov4 `
  listenport=443 listenaddress=127.0.0.1 `
  connectport=32769 connectaddress=127.0.0.1

# Confirm:
netsh interface portproxy show v4tov4
```

---

## Verify

```bash
# From WSL:
curl -k https://demo.local/api/users   # 200 / JSON
```

```text
# From Windows browser:
https://demo.local/
```

If the browser shows a TLS warning, the root CA may need re-importing: see
[wsl-browser-access.md](./wsl-browser-access.md) steps 8-9.
