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
const placeholderHref = new URL(productPlaceholder, window.location.href).href;

const applyPlaceholder = (img: HTMLImageElement) => {
  if (img.src === placeholderHref) return; // evita bucles
  img.src = productPlaceholder;
};

// 1) Imágenes que fallan al cargar. Se escucha en fase de captura porque el
//    evento `error` de las imágenes no burbujea hasta `window`.
window.addEventListener(
  "error",
  (event) => {
    const target = event.target as HTMLImageElement | null;
    if (!target || target.tagName !== "IMG") return;
    applyPlaceholder(target);
  },
  true,
);

// 2) Imágenes sin `src` (productos sin imagen): no disparan `error`, así que se
//    cubren observando cuándo aparecen en el DOM o cambia su `src`.
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
