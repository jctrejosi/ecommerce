import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Atrapa errores de renderizado de React para no dejar la pantalla en blanco.
 * Cualquier fallo en un componente muestra este aviso con botón de recargar.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Error de render capturado:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--background)",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: "var(--muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                margin: "0 auto 16px",
              }}
            >
              ⚠️
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
              Algo salió mal
            </h1>
            <p
              style={{
                color: "var(--muted-foreground)",
                fontSize: 14,
                margin: "0 0 16px",
                wordBreak: "break-word",
              }}
            >
              {this.state.error.message || String(this.state.error)}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "var(--secondary)",
                color: "var(--primary)",
                border: "none",
                borderRadius: 12,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Recargar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
