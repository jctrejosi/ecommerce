import logo from "../assets/logo.png";

// Footer institucional (DSI). Se usa tanto en el panel como en el login.
export default function AppFooter() {
  return (
    <footer
      className="shrink-0 border-t border-[color:var(--chrome-border)]"
      style={{ background: "var(--chrome-bg)" }}
    >
      <div className="flex flex-col md:flex-row items-center justify-center gap-x-4 gap-y-1 px-3 py-2 text-center">
        <a
          href="https://dsi.com.co"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center hover:opacity-80 transition-opacity"
        >
          <img src={logo} alt="Mercaldas" className="h-[26px] w-auto object-contain" />
        </a>
        <p className="text-xs text-[color:var(--chrome-text-muted)]">
          © 2026 Desarrollado por <span className="font-bold text-[color:var(--chrome-text)]">DSI SA</span> · Todos los derechos reservados
        </p>
        <p className="text-xs text-[color:var(--chrome-text-faint)]">
          Manizales, Caldas, Colombia
        </p>
      </div>
    </footer>
  );
}
