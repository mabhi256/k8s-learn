# WSL browser access checklist

Steps to run after every cluster start or restart to get `https://demo.local` working in a Windows browser.

---

## 1. Start cloud-provider-kind (dedicated WSL terminal)

Without this, every `LoadBalancer` Service stays `<pending>` and nothing is reachable.

```bash
sudo KUBECONFIG=$HOME/.kube/config $(go env GOPATH)/bin/cloud-provider-kind
```

Leave this terminal open.

---

## 2. Get the ingress IP

Wait until the ingress-nginx controller has an external IP (may take 10–20 s after cloud-provider-kind starts):

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# EXTERNAL-IP should be a 172.x.x.x address, not <pending>

INGRESS_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo $INGRESS_IP   # confirm non-empty before continuing
```

---

## 3. Update WSL /etc/hosts

```bash
# Replace any existing demo.local line, or add it:
sudo sed -i "s/.*demo\.local/$INGRESS_IP demo.local/" /etc/hosts

# If no line exists yet:
grep -q demo.local /etc/hosts || echo "$INGRESS_IP demo.local" | sudo tee -a /etc/hosts

# Confirm:
grep demo.local /etc/hosts
```

---

## 4. Remove loopback aliases

cloud-provider-kind adds the LoadBalancer IPs as aliases on WSL's loopback interface. When those aliases exist, the kernel treats the IP as local and kube-proxy's DNAT rules never fire - traffic never reaches the kindccm proxy container.

```bash
# Check what's on loopback:
ip addr show lo | grep '172\.'

# Delete each 172. alias shown (repeat for each IP):
sudo ip addr del 172.18.0.3/32 dev lo

# Verify traffic now routes via the Docker bridge, not loopback:
ip route get $INGRESS_IP
# should show: dev br-<id>  not  dev lo
```

cloud-provider-kind re-adds the aliases on each reconcile cycle. If curl stops working after a few minutes, re-run the `ip addr del` step.

---

## 5. Find the kindccm HTTPS port (PowerShell)

cloud-provider-kind creates `kindccm-*` containers that forward service ports to random high ports on `0.0.0.0`. The port changes every time the cluster is recreated.

```powershell
docker ps --format "table {{.Names}}`t{{.Ports}}" | findstr kindccm
# kindccm-xxxx   0.0.0.0:32768->80/tcp, 0.0.0.0:32769->443/tcp, ...
```

Note the port before `->443/tcp` (e.g. `32769`).

---

## 6. Update Windows hosts file (Admin PowerShell)

Point `demo.local` to Windows localhost, **not** to the cluster IP (`172.x.x.x` is only reachable from inside WSL):

```powershell
# Check what's already there:
Get-Content C:\Windows\System32\drivers\etc\hosts | Select-String "demo.local"

# Remove stale entries if present (any 172.x.x.x lines):
$content = Get-Content C:\Windows\System32\drivers\etc\hosts
$content | Where-Object { $_ -notmatch '172\.\d+\.\d+\.\d+.*demo\.local' } |
  Set-Content C:\Windows\System32\drivers\etc\hosts

# Add the correct entry:
Add-Content C:\Windows\System32\drivers\etc\hosts "127.0.0.1 demo.local"
```

---

## 7. Update the port proxy (Admin PowerShell)

Windows port 443 → kindccm HTTPS port from step 5. This proxy survives reboots but the target port changes on cluster recreation.

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

## 8. Check the TLS certificate (first time, or after cluster recreate)

```bash
# In WSL - cert should be Ready:
kubectl get certificate -A
# NAMESPACE   NAME             READY
# default     demo-local-tls   True

# If not Ready, check what's wrong:
kubectl describe certificate demo-local-tls
kubectl describe certificaterequest -n default
```

---

## 9. Trust the root CA in Windows (one-time per cluster, or after cluster recreate)

The cert is self-signed by `demo-root-ca`. Without importing it, the browser shows a security warning and curl requires `-k`.

**Extract the CA cert from PowerShell (do not use Out-File, it corrupts the PEM):**

```powershell
wsl -e sh -c "kubectl get secret demo-root-ca-tls -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d > /tmp/ca.crt"

$desktop = [Environment]::GetFolderPath("Desktop")
Copy-Item "\\wsl$\Ubuntu\tmp\ca.crt" "$desktop\ca.crt"

certutil -verify "$desktop\ca.crt"
# Should show: Verified Issuance Policies: All
```

**Import into Windows trust store (Admin PowerShell):**

```powershell
certutil -addstore -f "Root" "$env:USERPROFILE\Desktop\ca.crt"
```

Restart Chrome or Edge. Remove later with:

```powershell
certutil -delstore "Root" "demo-root-ca"
```

**Firefox extra step:**

Firefox ignores the Windows trust store. Import separately:
Settings → search **Certificates** → **View Certificates** → **Authorities** tab → **Import** → select `ca.crt` → check "Trust this CA to identify websites" → OK → restart Firefox.

---

## 10. Verify

```bash
# From WSL - should return 200 or a JSON response:
curl -k https://demo.local/api/users
```

```text
# From Windows browser:
https://demo.local/
```

Padlock should be solid (no warning) if the root CA was imported. If you still see a warning, the cert in the browser's cache may be stale. Open DevTools → Security → View certificate and confirm the issuer is `demo-root-ca`.

---

## Traffic path (Windows browser)

```text
Windows browser  https://demo.local
      │
      ▼  Windows hosts file: demo.local → 127.0.0.1
127.0.0.1:443 (Windows)
      │
      ▼  netsh portproxy
127.0.0.1:32769 (kindccm port, exposed to Windows by WSL2)
      │
      ▼  kindccm envoy container
172.18.0.3:443 (ingress-nginx LoadBalancer IP, inside Docker bridge)
      │
      ▼  ingress-nginx → Kubernetes Service → Pod
```

---

## After every cluster restart (quick reference)

Steps 1–4 and 7 must be repeated. Steps 6 and 9 only need repeating if the cluster was deleted and recreated (IP and cert change).

| Step | When |
|------|------|
| 1 – Start cloud-provider-kind | Every terminal session |
| 2 – Get INGRESS_IP | Every cluster start |
| 3 – Update WSL /etc/hosts | Every cluster start (IP may change) |
| 4 – Remove loopback aliases | Every cluster start; repeat if curl breaks |
| 5 – Find kindccm port | Every cluster start |
| 6 – Windows hosts file | Once, or after cluster recreate |
| 7 – Update port proxy | Every cluster start (port changes) |
| 8 – Check TLS cert | After cluster recreate |
| 9 – Import CA in browser | Once per cluster lifetime |
