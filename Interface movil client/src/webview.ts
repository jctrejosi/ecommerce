/**
 * Pista de compilación de la URL del servidor del cliente.
 *
 * En producción apunta a la tienda pública: el WebView carga la web y su API
 * por el mismo origen (o por el host del API). El APK valida con `GET
 * /discovery` cualquier candidato antes de usarlo (guardado en el dispositivo →
 * pista → esta URL → escaneo de la subred), así que si esta dirección deja de
 * servir, la app busca el servidor igual.
 *
 * Para desarrollo local, compila con EXPO_PUBLIC_WEB_URL=http://192.168.x.x:4173.
 */
export const WEB_CLIENT_URL = "https://ecommerce.jcti.xyz";
