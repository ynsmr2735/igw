import Link from "next/link";

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="igw-card-shine relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[14px] igw-gradient shadow-[0_8px_24px_rgba(127,0,255,0.35)]"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 22.5C6 16.7 10.5 12 16.2 12c4.1 0 7.3 2.6 7.3 6 0 3.2-2.6 5.5-6 5.5-2.6 0-4.5-1.6-4.5-3.7 0-1.8 1.3-3 3-3 1.2 0 2.2.8 2.2 1.9"
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="25.5" cy="8.5" r="2.5" fill="white" />
      </svg>
    </span>
  );
}

export function Brand({
  dark = false,
  href = "/",
  compact = false,
}: {
  dark?: boolean;
  href?: string;
  compact?: boolean;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3">
      <BrandMark size={compact ? 34 : 40} />
      <span className="flex flex-col leading-none">
        <span
          className={`text-[15px] font-extrabold tracking-tight ${dark ? "text-white" : "text-[#10152b]"}`}
        >
          insta<span className="igw-text-gradient">global</span>wallet
        </span>
        {!compact && (
          <span
            className={`mt-1 text-[9px] font-semibold uppercase tracking-[0.22em] ${dark ? "text-white/50" : "text-slate-400"}`}
          >
            Your money, everywhere
          </span>
        )}
      </span>
    </Link>
  );
}
