export function Logo({
  dark = true,
  logoSrc,
  hideTextOnMobile = false,
  imgClassName = "h-7 md:h-8 w-auto object-contain",
  boxClassName = "w-7 h-7 md:w-8 md:h-8",
}: {
  dark?: boolean;
  logoSrc?: string | null;
  hideTextOnMobile?: boolean;
  imgClassName?: string;
  boxClassName?: string;
}) {
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt="Mercaldas"
        className={imgClassName}
      />
    );
  }
  return (
    <div className="flex items-center gap-1 select-none">
      <div
        className={`${boxClassName} rounded-lg flex items-center justify-center font-black text-base md:text-lg leading-none`}
        style={{
          background: "var(--primary)",
          color: "var(--foreground)",
          fontFamily: "'Bricolage Grotesque', sans-serif",
        }}
      >
        M
      </div>
      <span
        className={`font-black text-xl tracking-tight leading-none ${
          hideTextOnMobile ? "hidden md:inline" : ""
        }`}
        style={{
          color: dark ? "var(--foreground)" : "#ffffff",
          fontFamily: "'Bricolage Grotesque', sans-serif",
          letterSpacing: "-0.02em",
        }}
      >
        ERCALDAS
      </span>
    </div>
  );
}
