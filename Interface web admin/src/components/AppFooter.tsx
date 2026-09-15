import logo from "../assets/logo.png";

// Footer institucional (DSI). Se usa tanto en el panel como en el login.
export default function AppFooter() {
  return (
    <footer className="shrink-0" style={{ background: "#111827" }}>
      <div className="flex flex-col md:flex-row items-center justify-center gap-x-4 gap-y-1 px-3 py-2 text-center">
        <a
          href="https://dsi.com.co"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center hover:opacity-80 transition-opacity"
        >
          <img src={logo} alt="Mercaldas" className="h-[26px] w-auto object-contain" />
        </a>
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
          © 2026 Desarrollado por <span className="font-bold text-white/70">DSI SA</span> · Todos los derechos reservados
        </p>
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          Manizales, Caldas, Colombia
        </p>
      </div>
    </footer>
  );
}
