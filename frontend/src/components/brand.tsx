import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? " brand--compact" : ""}`}>
      <Image
        src={compact ? "/icon.svg" : "/brand/stemora-sunset-logo.svg"}
        alt="STEMORA"
        width={compact ? 40 : 192}
        height={compact ? 40 : 43}
        priority
        unoptimized
      />
    </div>
  );
}
