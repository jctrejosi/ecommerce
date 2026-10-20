import "./styles/index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app/App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { apiStatusService } from "./services/api-status.service";
import productPlaceholder from "./assets/product-placeholder.svg";

// Evita el ícono de "imagen rota" en TODA la app: cualquier <img> que falle
// (imagen inexistente, 404 o src vacío) se reemplaza por una imagen de ejemplo.
// Como el fallo puede ser transitorio (el servidor está arrancando, la red del
// móvil cae un momento, se acaba de migrar el catálogo…), además se reintenta la
// imagen real varias veces: si no, un fallo puntual dejaría el placeholder fijo.
const placeholderHref = new URL(productPlaceholder, window.location.href).href;
const MAX_IMG_RETRIES = 4;
const IMG_RETRY_MS = 2500;

/** Quita el cache-bust `_r=N` que se agrega al reintentar. */
const baseSrc = (url: string) => url.replace(/([?&])_r=\d+$/, "");

const isPlaceholder = (img: HTMLImageElement) =>
  img.getAttribute("src") === productPlaceholder || img.src === placeholderHref;

const applyPlaceholder = (img: HTMLImageElement) => {
  // Se lee el atributo (no la propiedad): así distinguimos una imagen con `src`
  // real de una sin `src` (producto sin imagen), y comparamos exacto contra el
  // placeholder aunque el navegador haya normalizado el data URI en `img.src`.
  const failed = img.getAttribute("src") || "";
  const failedBase = failed ? baseSrc(failed) : "";

  // Imagen nueva (React cambió el `src`): se reinicia el contador de reintentos.
  if (failedBase && failedBase !== baseSrc(img.dataset.realSrc || "")) {
    img.dataset.realSrc = failedBase;
    img.dataset.retries = "0";
  }

  // Aplica el placeholder tanto si la imagen falló como si no tenía `src`.
  if (!isPlaceholder(img)) img.src = productPlaceholder;

  const real = img.dataset.realSrc;
  if (!real) return;

  const tries = Number(img.dataset.retries || "0");
  if (tries >= MAX_IMG_RETRIES) return;
  img.dataset.retries = String(tries + 1);

  window.setTimeout(
    () => {
      // Sólo se reintenta si el placeholder sigue puesto (la app no lo cambió).
      if (!img.isConnected) return;
      if (!isPlaceholder(img)) return;
      if (img.dataset.realSrc !== real) return;
      img.src = `${real}${real.includes("?") ? "&" : "?"}_r=${tries + 1}`;
    },
    IMG_RETRY_MS * (tries + 1),
  );
};

// 1) Imágenes que fallan al cargar. Se escucha en fase de captura porque el
//    evento `error` de las imágenes no burbujea hasta `window`.
window.addEventListener(
  "error",
  (event) => {
    const target = event.target as HTMLImageElement | null;
    if (!target || target.tagName !== "IMG") return;
    if (isPlaceholder(target)) return; // el placeholder tampoco cargó: no insistir
    applyPlaceholder(target);
  },
  true,
);

// 2) Al cargar bien una imagen se olvida el reintento y se guarda su URL real
//    (sin cache-bust), para poder reintentarla si más adelante falla.
window.addEventListener(
  "load",
  (event) => {
    const target = event.target as HTMLImageElement | null;
    if (!target || target.tagName !== "IMG") return;
    if (isPlaceholder(target)) return;
    delete target.dataset.retries;
    target.dataset.realSrc = baseSrc(target.src);
  },
  true,
);

// 3) Imágenes sin `src` (productos sin imagen): no disparan `error`, así que se
//    cubren observando cuándo aparecen en el DOM o cuando cambia su `src`.
const fixMissing = (node: Node) => {
  const images =
    node instanceof HTMLImageElement
      ? [node]
      : Array.from((node as ParentNode).querySelectorAll?.("img") ?? []);
  for (const img of images) {
    if (!img.getAttribute("src")) applyPlaceholder(img);
  }
};
new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "attributes") {
      const el = record.target;
      if (el instanceof HTMLImageElement && !el.getAttribute("src")) {
        applyPlaceholder(el);
      }
      continue;
    }
    for (const node of record.addedNodes) fixMissing(node);
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src"],
});

const renderApp = async () => {
  try {
    await apiStatusService.waitUntilReady();
  } catch (error) {
    console.error("Backend no disponible:", error);
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>,
  );
};

void renderApp();
