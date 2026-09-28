/**
 * Pista de compilación de la URL del servidor del cliente.
 *
 * Es **opcional**: el APK valida con `GET /discovery` cualquier candidato antes
 * de usarlo (guardado en el dispositivo → pista → URL por defecto → escaneo de
 * la subred), así que si esta dirección deja de servir, la app encuentra el
 * servidor igual y lo guarda para los siguientes arranques. Solo aporta un
 * arranque en frío más rápido (~1 s) cuando acierta.
 *
 * Se usa la **IP literal** (`http://192.168.0.132:4173`), que es el
 * `redirect_uri` registrado en Google Cloud Console para el login con Google.
 * Si el PC cambia de IP, la app lo reencuentra por escaneo de subred.
 */
export const WEB_CLIENT_URL = "http://192.168.0.132:4173";
