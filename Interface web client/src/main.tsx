import "./styles/index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter } from "react-router";
import App from "./app/App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { apiStatusService } from "./services/api-status.service";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

const renderApp = async () => {
  try {
    await apiStatusService.waitUntilReady();
  } catch (error) {
    console.error("Backend no disponible:", error);
  }

  const app = (
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  );

  ReactDOM.createRoot(document.getElementById("root")!).render(
    googleClientId ? (
      <GoogleOAuthProvider clientId={googleClientId}>
        {app}
      </GoogleOAuthProvider>
    ) : (
      app
    ),
  );
};

void renderApp();
