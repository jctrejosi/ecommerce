# Ollama en `dsi-vps` (Windows Server 2022 + WSL2)

Instalación de **Ollama con GPU** en el VPS Windows y notas de operación.
Complementa [`VPS-WINDOWS.md`](./VPS-WINDOWS.md).

## Resumen

| Dato | Valor |
|---|---|
| Host | `dsi-vps` (`WIN-U4554GS26I9`, Windows Server 2022) |
| GPU | **NVIDIA Tesla P100-PCIE-16GB** (16 GB VRAM, `compute 6.0`) |
| Driver | 582.78 / CUDA 13.0, **modo TCC** |
| Ollama | **0.40.14**, binario Windows en `C:\Users\Desarrolo4\ollama\` |
| Endpoint | `http://127.0.0.1:11434` (también escucha en `0.0.0.0:11434`) |
| Modelos | `qwen3:14b` (9,3 GB) y `qwen3:8b` (5,2 GB) |
| Datos | `C:\Users\Desarrolo4\.ollama\models` |

## Por qué corre como proceso Windows (y no como servicio de WSL)

La P100 está en **modo TCC** (compute-only). WSL2 solo accede a la GPU con el
driver en modo **WDDM**, así que dentro de la distro `nvidia-smi` responde
`GPU access blocked by the operating system`. Por eso Ollama **no** puede
ejecutarse en WSL: se ejecuta como proceso de Windows, que sí ve la GPU.

La instalación Linux de Ollama que quedó en la distro está **deshabilitada**
(`systemctl disable --now ollama`) justo para no competir por el puerto.

Verificación de que la GPU se está usando:

```powershell
curl.exe -s http://127.0.0.1:11434/api/ps
```

Debe mostrar `"size_vram"` **igual** a `"size"` (modelo 100 % en VRAM).

## Modelos instalados

| Modelo | Tamaño | Uso recomendado |
|---|---|---|
| `qwen3:14b` | 9,3 GB | **Por defecto**: mejor calidad que cabe entero en 16 GB |
| `qwen3:8b` | 5,2 GB | Respuestas rápidas / más concurrencia |

Ambos en `Q4_K_M`, contexto por defecto **8192** tokens
(`OLLAMA_CONTEXT_LENGTH`); un cliente puede pedir más por request. Con
`num_ctx=32768` el modelo ocupa **14,4 GB de 15,9 GB** de VRAM y sigue 100 % en
GPU.

Rendimiento medido en este servidor (P100, `qwen3:14b`): **~34 tok/s** de
generación y ~14 tok/s de *prompt eval* con el modelo cargado en VRAM.

## Arranque y persistencia

`C:\Users\Desarrolo4\start-ollama.cmd` arranca el servidor con los límites
adecuados (`OLLAMA_HOST=0.0.0.0:11434`, `KEEP_ALIVE=30m`, `NUM_PARALLEL=1`,
`MAX_LOADED_MODELS=1`, `CONTEXT_LENGTH=8192`) y es **idempotente**: si el puerto
ya está escuchando, termina sin hacer nada.

Se lanza oculto con `C:\Users\Desarrolo4\start-ollama.vbs`, registrado en:

1. `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (valor `OllamaServe`).
2. `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\start-ollama.vbs`.

Con eso Ollama vuelve a levantarse **al iniciar sesión** de `Desarrolo4`.

> Limitación: es una tarea de *logon*, no de *boot*. Si el servidor reinicia y
> nadie inicia sesión, Ollama no arranca. Para hacerlo de nivel servicio hace
> falta **administrador** (ver «Pendientes con administrador»).

Comandos útiles:

```powershell
# Estado / modelos
curl.exe -s http://127.0.0.1:11434/api/tags

# Log del servidor
Get-Content C:\Users\Desarrolo4\ollama-serve.log -Tail 30

# Reiniciar a mano (desde una sesión de Desarrolo4)
Get-Process ollama | Stop-Process -Force
wscript C:\Users\Desarrolo4\start-ollama.vbs
```

## Descargar otro modelo

El cliente debe ser el de **Windows** (el servidor vive allí). Desde WSL se
puede lanzar por interop, pero hay que fijar el socket de interop a mano:

```bash
# desde el VPS, vía wsl:
wsl -d Ubuntu -u root -- env WSL_INTEROP=/run/WSL/1_interop \
  /mnt/c/Users/Desarrolo4/ollama/ollama.exe pull qwen3:14b
```

Script de apoyo en el repo: `scripts-agent/ollama/pull-model.sh`.

> Cuidado: si la sesión SSH se corta a mitad de la descarga, el `pull` se
> cancela (el servidor descarta el contexto del cliente). Los blobs parciales se
> reutilizan al reintentar, así que no se pierde lo avanzado.

Modelos candidatos según VRAM (16 GB, Pascal):

| Modelo | Tamaño Q4 | Comentario |
|---|---|---|
| `qwen3:14b` | 9,3 GB | Mejor equilibrio; deja margen para contexto |
| `qwen3:8b` | 5,2 GB | Más rápido, útil para chat de alta frecuencia |
| `gemma3:27b` / `qwen2.5:32b` | >17 GB | **No caben** enteros en VRAM: caen a CPU y van lentos |

## Consumo desde el tailnet (Tailscale)

El host está en el tailnet como **`dsi-vps-windows-server`** y su IP de
Tailscale es **`100.124.20.39`** (estable).

`tailscale serve` **no hace falta**: Tailscale instala sus propias reglas de
entrada en Windows, así que cualquier servicio que escuche en `0.0.0.0` queda
accesible **desde los dispositivos del tailnet** sin tocar el firewall. Ya está
verificado desde el equipo cliente:

```bash
curl -s http://100.124.20.39:11434/api/version     # {"version":"0.40.14"}
curl -s http://100.124.20.39:11434/v1/models       # catálogo OpenAI-compatible
```

> Importante: eso vale para el **tailnet**, no para internet ni para WSL. Desde
> fuera de Tailscale el puerto sigue cerrado, y los contenedores de la propia
> distro WSL tampoco lo alcanzan (red NAT + firewall de Windows).

### Endpoint para clientes

La **API nativa** de Ollama (la que usa el proveedor `ollama` de Zed) va **sin
`/v1`**. Los clientes que solo hablan OpenAI añaden `/v1`.

| Vía | URL base nativa | `/v1` (OpenAI-compatible) | Requiere |
|---|---|---|---|
| **IP del tailnet** (actual) | `http://100.124.20.39:11434` | `http://100.124.20.39:11434/v1` | Estar en el tailnet |
| MagicDNS | `http://dsi-vps-windows-server:11434` | `...:11434/v1` | Activar *MagicDNS* (gratis) |
| `tailscale serve` (HTTPS) | `https://dsi-vps-windows-server.tailfad8d7.ts.net` | `.../v1` | Activar *Serve* una vez (`https://login.tailscale.com/f/serve?node=ncs3zG5HtM11CNTRL`) |
| Túnel SSH | `http://127.0.0.1:11434` | `http://127.0.0.1:11434/v1` | Solo desde el equipo que abre el túnel |

La IP del tailnet basta para trabajar. MagicDNS es solo comodidad, y `serve`
útil si se quiere HTTPS con certificado válido.

> Si se usa `serve`, **nunca** `funnel`: `funnel` publica a internet abierto y
> Ollama no tiene autenticación.

### Fallback: túnel SSH (sin depender de nada del tailnet)

```bash
ssh -f -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -L 11434:127.0.0.1:11434 dsi-vps
pkill -f "L 11434:127.0.0.1:11434"               # para cerrarlo
```

### Configurar Zed contra Ollama

Usa el proveedor **nativo** `ollama` de Zed: apunta a la API nativa (**sin
`/v1`**) y **descubre solo** los modelos ya descargados (`/api/tags`).

```json
{
  "language_models": {
    "ollama": {
      "api_url": "http://100.124.20.39:11434",
      "context_window": 32768
    }
  }
}
```

- **Sin `/v1`**: `http://100.124.20.39:11434/v1/api/tags` responde `404` y Zed no
  vería ningún modelo.
- `context_window: 32768`: Zed envía el contexto como `num_ctx` (por defecto
  `4096`). **No bajes de 16k si vas a usar el agente**: el system prompt de Zed
  más los esquemas de herramientas ocupan varios miles de tokens, y con una
  ventana chica el modelo recibe las herramientas pero **pierde la instrucción**
  (síntoma típico: responde “no se proporcionó ninguna tarea”).
- No hace falta API key.
- El agente de Zed usa herramientas por la API nativa de Ollama; verificado que
  `qwen3:14b` emite `tool_calls` correctamente.

Si prefieres fijar la lista a mano (para marcar explícitamente *tools* y
*thinking*), desactiva el autodescubrimiento:

```json
{
  "language_models": {
    "ollama": {
      "api_url": "http://100.124.20.39:11434",
      "auto_discover": false,
      "available_models": [
        {
          "name": "qwen3:14b",
          "display_name": "Qwen3 14B (dsi-vps)",
          "max_tokens": 32768,
          "supports_tools": true,
          "supports_thinking": true
        },
        {
          "name": "qwen3:8b",
          "display_name": "Qwen3 8B (dsi-vps)",
          "max_tokens": 16384,
          "supports_tools": true,
          "supports_thinking": true
        }
      ]
    }
  }
}
```

Alternativa con `openai_compatible` (solo si un cliente exige la ruta `/v1`):
`api_url` = `http://100.124.20.39:11434/v1` y lista **explícita** de modelos
(esta ruta no autodescubre).

Notas:

- Ollama no pide credenciales, pero si Zed exige una API key, cualquier texto
  sirve.
- Qwen3 razona antes de responder (*thinking*), y eso consume tokens: con
  `max_tokens` bajo la respuesta puede salir vacía. Usa 8192 en el modelo. Si el
  cliente permite enviar `"reasoning_effort": "none"` (o `"think": false` en la
  API nativa), el razonamiento se desactiva y responde directo.

### Comprobación rápida del endpoint

```bash
curl -s http://100.124.20.39:11434/api/tags          # modelos (API nativa)
curl -s http://100.124.20.39:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3:8b","messages":[{"role":"user","content":"Responde solo: ok"}],"stream":false,"think":false}'
curl -s http://100.124.20.39:11434/v1/models         # catálogo OpenAI-compatible
```

## Seguridad

- Ollama **no tiene autenticación**. Cualquiera con acceso al puerto puede usar
  el modelo y ver/gestionar modelos.
- `11434` **no está expuesto a internet**: se comprobó desde fuera y la conexión
  al IP público (`170.254.229.68:11434`) expira. La única regla de entrada del
  host sigue siendo `80/443` (ver `VPS-WINDOWS.md`).
- El acceso remoto se resuelve **dentro del tailnet**: Tailscale ya permite la
  entrada al puerto en su propia interfaz (verificado: la IP `100.124.20.39`
  responde desde el equipo cliente). Cualquier dispositivo del tailnet puede usar
  el modelo, así que conviene que el tailnet sea solo de dispositivos propios y
  revisar periódicamente la lista de máquinas.
- No usar `tailscale funnel`: publica el servicio a internet abierto y Ollama no
  tiene autenticación.
- Desde WSL/contenedores **hoy no es alcanzable** (el firewall de Windows
  bloquea la conexión al host). Eso es intencional hasta definir el uso.
- Si se quiere consumir desde los contenedores, **solo** con una regla limitada
  a la subred de WSL (nunca abrir a `Any`):

```powershell
# Como administrador
New-NetFirewallRule -DisplayName "Ollama 11434 (solo WSL)" `
  -Direction Inbound -Protocol TCP -LocalPort 11434 `
  -RemoteAddress 172.16.0.0/12 -Action Allow -Profile Any
```

  y luego consumir desde el contenedor con `http://<gateway-de-WSL>:11434`
  (`ip route show default` dentro de WSL) o el nombre del host en redes
  `mirrored`.

## Pendientes con administrador (no se pudieron hacer sin elevación)

`Desarrolo4` **no es administrador**, y estas acciones fueron rechazadas:
`schtasks /create`, WMI `Win32_Process.Create` y `Get-CimInstance`. Quedan
pendientes, todas opcionales:

1. **Servicio de verdad** (arranque al boot, sin sesión iniciada). Crear en el
   Programador de tareas, como las tareas `Mercaldas*` existentes:
   - Nombre: `OllamaServe`
   - Desencadenador: *Al iniciar el sistema*
   - Acción: `C:\Users\Desarrolo4\start-ollama.cmd`
   - Cuenta: `Desarrolo4`, **«Ejecutar tanto si el usuario inició sesión como si
     no»** (S4U, sin guardar contraseña), *Ejecutar con privilegios más altos*.

2. **Regla de firewall** para la subred de WSL (comando arriba), si se quiere
   usar desde los contenedores.

3. *(Alternativa recomendada a medio plazo)* Pasar la GPU a **WDDM** con
   `nvidia-smi -g 0 -dm 1` y reiniciar; después Ollama podría vivir **dentro de
   WSL** como servicio systemd, integrándose directo con la red de Docker sin
   reglas de firewall en Windows. Requiere administrador y reinicio del host.

## Diagnóstico rápido

| Síntoma | Causa / solución |
|---|---|
| `nvidia-smi` en WSL: *GPU access blocked* | GPU en TCC; esperado. Usar Ollama de Windows |
| `ollama: Solo se permite un uso de cada dirección de socket` | Ya hay una instancia escuchando; no arrancar otra |
| `pull` se corta solo | Se cerró la sesión SSH que lo lanzaba; reintentar |
| `ExecStart .../ollama.exe: Invalid argument` en una unidad systemd | El interop de WSL no funciona como servicio; usar la tarea de logon |
| Carga inicial ~90 s | Normal con el modelo frío en disco; luego queda en VRAM 30 min |
