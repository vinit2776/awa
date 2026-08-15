import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-muted-foreground",
        info: "",
        warning: "",
        success: "",
        destructive: "",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)

// Colored (non-neutral) variants are tinted via inline style, computed
// from the app's existing design tokens, rather than Tailwind's
// bg-<color>/10 opacity-modifier utilities — those utilities depend on
// Tailwind generating a derived color-mix() rule for each token at
// build time, and that derivation didn't reliably pick up these tokens
// for a newly-added component in local testing (the base tokens
// resolve fine; only the derived utility failed to apply). Inline
// color-mix() using the same tokens sidesteps that without depending
// on why. "info" reuses --chart-1 (the app has no dedicated "info"
// token) rather than introducing a new one — brand-new custom
// properties hit the same unreliable pickup this whole variant list is
// working around, so adding another one defeats the point.
const VARIANT_TOKEN = {
  neutral: null,
  info: "--chart-1",
  warning: "--warning",
  success: "--success",
  destructive: "--destructive",
} as const;

function Badge({
  className,
  variant = "neutral",
  style,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  const token = VARIANT_TOKEN[variant ?? "neutral"];
  const tintStyle: React.CSSProperties | undefined = token
    ? { backgroundColor: `color-mix(in oklab, var(${token}) 10%, transparent)`, color: `var(${token})` }
    : undefined;

  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      style={{ ...tintStyle, ...style }}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
