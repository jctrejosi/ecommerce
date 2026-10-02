#!/usr/bin/env bash
# Descarga C:\JUAN_CARLOS\PUNTO_C desde el Windows remoto por SMB (share C$).
# Pide la contraseña una vez y la usa vía archivo temporal (borrado al final).
set -u

SERVER=89.117.149.145
USER_NAME=Desarrollo3
REMOTE_DIR='JUAN_CARLOS\PUNTO_C'
DEST=/home/jk/Descargas/punto_c
AUTH=/dev/shm/rdp-dl.auth

read -r -s -p "Contraseña de ${USER_NAME}: " PASS
echo
umask 077
printf 'username=%s\npassword=%s\n' "$USER_NAME" "$PASS" > "$AUTH"

mkdir -p "$DEST"
echo "Descargando //${SERVER}/C\$/${REMOTE_DIR}  ->  ${DEST}"
smbclient "//${SERVER}/C\$" -A "$AUTH" \
  -c 'recurse ON; prompt OFF; lcd '"$DEST"'; cd '"$REMOTE_DIR"'; mget *'
RC=$?

rm -f "$AUTH"

if [ "$RC" -eq 0 ]; then
  echo "--- LISTO: archivos en ${DEST} ---"
else
  echo "--- TERMINÓ CON ERROR (código $RC). Revisa el mensaje de smbclient arriba. ---"
fi
read -r -p "Pulsa Enter para cerrar..."
