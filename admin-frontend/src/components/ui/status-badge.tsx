import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors border",
  {
    variants: {
      status: {
        active: "bg-green-100 text-green-800 border-green-200",
        inactive: "bg-gray-100 text-gray-800 border-gray-200",
        pending: "bg-amber-100 text-amber-800 border-amber-200",
        processing: "bg-blue-100 text-blue-800 border-blue-200 animate-pulse",
        transcoding: "bg-blue-100 text-blue-800 border-blue-200 animate-pulse",
        queued: "bg-yellow-100 text-yellow-800 border-yellow-200",
        ready: "bg-green-100 text-green-800 border-green-200",
        error: "bg-red-100 text-red-800 border-red-200",
        paused: "bg-yellow-100 text-yellow-800 border-yellow-200",
        archived: "bg-gray-100 text-gray-600 border-gray-200",
      },
    },
    defaultVariants: {
      status: "inactive",
    },
  }
)

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  label?: string
}

export function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const displayLabel = label || (status ? status.charAt(0).toUpperCase() + status.slice(1) : '')

  return (
    <span className={cn(statusBadgeVariants({ status }), className)} {...props}>
      {displayLabel}
    </span>
  )
}
