#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Restringe los puertos HTTP/HTTPS del ORIGEN a las IPs de Cloudflare.
#
# Por qué no basta `ufw allow/deny`: Docker publica 80/443 y ese tráfico entra
# por la cadena FORWARD (DNAT de Docker), NO por INPUT, así que las reglas de
# ufw no lo ven. La cadena `DOCKER-USER` sí se evalúa ANTES de las reglas de
# Docker, y es donde se filtra.
#
# OJO (importante): DOCKER-USER también ve el tráfico de SALIDA de los
# contenedores (contenedor → internet). Por eso todas las reglas se limitan a la
# interfaz WAN (`-i $WAN_IF`): sin esa condición se rompen las llamadas salientes
# a DeepSeek/Cloudinary/Google/Wompi. El tráfico entre contenedores entra por
# `docker0`/`br-*` y no se toca.
#
# Efecto: con el proxy naranja de Cloudflare delante, los navegadores entran por
# Cloudflare; quien intente pegarle a la IP del servidor directo a 80/443 no
# recibe respuesta (la IP de origen queda oculta tras el proxy).
#
# Rangos: https://www.cloudflare.com/ips-v4 y https://www.cloudflare.com/ips-v6
# Si Cloudflare publica rangos nuevos, actualiza las listas y ejecuta
# `systemctl restart cloudflare-origin-firewall`.
#
# OJO: si algún registro DNS se pone en "DNS only" (gris), dejará de responder;
# es intencionado. SSH (22) y Tailscale no se tocan.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
PATH=/usr/sbin:/sbin:/usr/bin:/bin

PORTS="80,443"

# Interfaz por la que entra el tráfico de internet.
WAN_IF="${WAN_IF:-$(ip -o -4 route show to default | awk '{print $5; exit}')}"
ADMIN_IFS="tailscale0"

CF4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
CF6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"

apply() {
  cmd="$1"
  ranges="$2"

  if ! $cmd -S DOCKER-USER >/dev/null 2>&1; then
    $cmd -N DOCKER-USER
  fi

  # Idempotente: se reescribe entera (nadie más la usa en este servidor).
  $cmd -F DOCKER-USER

  # 1. Respuestas de conexiones ya establecidas (no romper el tráfico saliente).
  $cmd -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

  # 2. La red de administración (Tailscale) pasa siempre.
  for iface in $ADMIN_IFS; do
    $cmd -A DOCKER-USER -i "$iface" -j RETURN
  done

  # 3. Permitir 80/443 solo desde Cloudflare, y solo por la interfaz WAN.
  for cidr in $ranges; do
    $cmd -A DOCKER-USER -i "$WAN_IF" -s "$cidr" -p tcp -m multiport --dports "$PORTS" -j RETURN
  done

  # 4. Cualquier otro origen de internet hacia 80/443, descartado.
  $cmd -A DOCKER-USER -i "$WAN_IF" -p tcp -m multiport --dports "$PORTS" -j DROP

  # 5. El resto del tráfico sigue su curso normal (Docker lo decide).
  $cmd -A DOCKER-USER -j RETURN
}

apply iptables "$CF4"
if command -v ip6tables >/dev/null 2>&1; then
  apply ip6tables "$CF6"
fi

echo "cloudflare-origin-firewall: 80/443 en $WAN_IF restringidos a rangos de Cloudflare."
