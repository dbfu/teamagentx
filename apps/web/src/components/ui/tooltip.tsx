
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  // 如果使用 asChild，需要在子元素的 onClick 中添加 blur
  if (asChild && React.isValidElement(children)) {
    const childProps = children.props as Record<string, unknown>
    const originalOnClick = childProps.onClick as React.MouseEventHandler | undefined
    const blendedOnClick = (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.blur()
      originalOnClick?.(e)
    }
    return (
      <TooltipPrimitive.Trigger data-slot="tooltip-trigger" asChild {...props}>
        {React.cloneElement(children, { onClick: blendedOnClick } as Record<string, unknown>)}
      </TooltipPrimitive.Trigger>
    )
  }
  // 非 asChild 模式，直接在触发元素上处理
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.blur()}
      {...props}
    >
      {children}
    </TooltipPrimitive.Trigger>
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
