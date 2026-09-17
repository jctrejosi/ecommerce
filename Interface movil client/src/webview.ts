/**
 * Pista de compilación de la URL del servidor del cliente.
 *
 * Es **opcional**: el APK valida con `GET /discovery` cualquier candidato antes
 * de usarlo (guardado en el dispositivo → pista → URL por defecto → escaneo de
 * la subred), así que si esta dirección deja de servir, la app encuentra el
 * servidor igual y lo guarda para los siguientes arranques. Solo aporta un
 * arranque en frío más rápido (~1 s) cuando acierta.
 *
 * Se usa el **hostname** (`192-168-0-132.sslip.io`) y no la IP porque Google
 * Identity Services exige un origen con dominio para el login con Google; el
 * alias resuelve a `192.168.0.132` y hay que tenerlo registrado en los
 * "Authorized JavaScript origins" del cliente OAuth.
 */
export const WEB_CLIENT_URL = "http://192-168-0-132.sslip.io:4173";
