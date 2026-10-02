import logo from '../assets/logo.png';

// Footer institucional (DSI). Sigue el tema del panel (claro u oscuro); se usa
// tanto en el panel como en la pantalla de login.
export default function AppFooter() {
  return (
    <footer className="app-footer shrink-0 border-t border-line">
      <div className="flex flex-col items-center justify-center gap-x-4 gap-y-1 px-3 py-2 text-center md:flex-row">
        <a
          href="https://dsi.com.co"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center transition-opacity hover:opacity-80"
        >
          {/* h-[22px]: 10% menos que los 24px anteriores. */}
          <img src={logo} alt="Mercaldas" className="h-[22px] w-auto object-contain" />
        </a>
        <p className="text-xs text-ink-soft">
          © 2026 Desarrollado por <span className="font-bold text-ink">DSI SA</span> · Todos los
          derechos reservados
        </p>
        <p className="text-xs text-ink-faint">Manizales, Caldas, Colombia</p>
      </div>
    </footer>
  );
}
