"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-start gap-1 border-b border-border text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch group-data-vertical/tabs:border-b-0 group-data-vertical/tabs:border-r",
  {
    variants: {
      variant: {
        default: "group-data-horizontal/tabs:h-10",
        line: "group-data-horizontal/tabs:h-10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full items-center justify-center gap-1.5 bg-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground active:translate-y-px disabled:pointer-events-none disabled:opacity-50 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-[opacity,transform] after:duration-200 after:ease-[cubic-bezier(0.16,1,0.3,1)] after:content-['']",
        "group-data-horizontal/tabs:after:inset-x-3 group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-px group-data-horizontal/tabs:after:origin-left group-data-horizontal/tabs:after:scale-x-0",
        "group-data-horizontal/tabs:hover:after:scale-x-100 group-data-horizontal/tabs:hover:after:opacity-45",
        "group-data-horizontal/tabs:data-active:after:scale-x-100 group-data-horizontal/tabs:data-active:after:opacity-100 group-data-horizontal/tabs:data-active:hover:after:opacity-100",
        "group-data-vertical/tabs:after:inset-y-2 group-data-vertical/tabs:after:right-0 group-data-vertical/tabs:after:w-px group-data-vertical/tabs:after:origin-top group-data-vertical/tabs:after:scale-y-0",
        "group-data-vertical/tabs:data-active:after:scale-y-100 group-data-vertical/tabs:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
