import { useEffect, useRef } from "react";
import { SkeletonCard } from "./SkeletonCard";

export function InfiniteScrollTrigger({
  onIntersect,
  count,
  disabled = false,
}: {
  onIntersect: () => void;
  count: number;
  disabled?: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || disabled) return;

    // Cada vez que (re)observamos, liberamos el lock: el sentinel se vuelve a
    // montar tras cada carga y debe poder disparar la siguiente página.
    loadingRef.current = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingRef.current) {
          loadingRef.current = true;
          onIntersect();
        }
      },
      { rootMargin: "300px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [onIntersect, disabled]);

  return (
    <div>
      {/* Skeleton grid shown while loading the next page */}
      {count > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
          {Array.from({ length: count }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
      {/* Invisible sentinel at the bottom (only while more pages exist) */}
      {!disabled && <div ref={sentinelRef} className="h-1 w-full" />}
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}
