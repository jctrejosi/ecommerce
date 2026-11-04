@echo off
REM Arranca Ollama en Windows nativo.
REM La NVIDIA Tesla P100 esta en modo TCC y WSL no puede usar la GPU, por eso
REM Ollama corre como proceso Windows (la GPU si es visible desde Windows).
REM Idempotente: si el puerto 11434 ya esta escuchando, sale sin hacer nada.

netstat -ano | findstr /c:":11434" | findstr /i "LISTENING" >nul 2>&1 && exit /b 0

set OLLAMA_HOST=0.0.0.0:11434
set OLLAMA_KEEP_ALIVE=30m
set OLLAMA_NUM_PARALLEL=1
set OLLAMA_MAX_LOADED_MODELS=1
set OLLAMA_CONTEXT_LENGTH=8192

"C:\Users\Desarrolo4\ollama\ollama.exe" serve >> "C:\Users\Desarrolo4\ollama-serve.log" 2>&1
