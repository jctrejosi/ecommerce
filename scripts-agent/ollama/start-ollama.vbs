' Lanza Ollama sin ventana visible. Pensado para el arranque de sesion
' (clave HKCU\...\Run y carpeta Startup).
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Users\Desarrolo4\start-ollama.cmd""", 0, False
