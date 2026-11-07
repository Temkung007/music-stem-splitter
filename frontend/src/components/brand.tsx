import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? " brand--compact" : ""}`}>
      <Image
        src={compact ? "/brand/stemora-symbol.svg" : "/brand/stemora-logo.svg"}
        alt="stemora"
        width={compact ? 40 : 192}
        height={compact ? 40 : 66}
        priority
        unoptimized
      />
    </div>
  );
}
