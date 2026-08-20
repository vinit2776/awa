import { cn } from "@/lib/utils"

// Decorative-only accents — never used to encode status, per the design
// system's rule that sage/lavender are for avatars/tags, not state. Not
// existing CSS custom properties (unlike badge.tsx's status colors), so
// these are the literal hexes the design handoff specifies.
const DECORATIVE_TONES = ["#BCD1CA", "#CBCADB"] as const

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function toneFor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return DECORATIVE_TONES[Math.abs(hash) % DECORATIVE_TONES.length]
}

function Avatar({
  name,
  tone,
  className,
}: {
  name: string
  /** Override the hash-derived tone, e.g. to keep one person's color stable across two avatar instances. */
  tone?: string
  className?: string
}) {
  return (
    <span
      data-slot="avatar"
      title={name}
      className={cn(
        "inline-flex size-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-foreground/80",
        className,
      )}
      style={{ backgroundColor: tone ?? toneFor(name) }}
    >
      {initials(name)}
    </span>
  )
}

export { Avatar }
