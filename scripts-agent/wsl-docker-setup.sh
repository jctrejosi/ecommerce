#!/bin/bash
# Motor Docker persistente dentro de la distro WSL `Ubuntu` del VPS.
# - Docker Engine de Ubuntu (docker.io), arranca con systemd.
# - API local en 127.0.0.1:2375 (WSL -> Windows localhost), nunca en LAN.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y docker.io docker-compose-v2

mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF

cat > /etc/wsl.conf <<'EOF'
[boot]
systemd=true
EOF

# El unit de Docker arranca con `-H fd://`; añadimos el API TCP solo en loopback.
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375 --containerd=/run/containerd/containerd.sock
EOF

systemctl daemon-reload
systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker
sleep 3
/usr/bin/docker version --format 'engine={{.Server.Version}}'
echo SETUP_DONE
