import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

interface ButtonGroupContextValue {
  orientation?: "horizontal" | "vertical"
}

const ButtonGroupContext = React.createContext<ButtonGroupContextValue>({
  orientation: "horizontal",
})

const useButtonGroup = () => {
  const context = React.useContext(ButtonGroupContext)
  if (!context) {
    throw new Error("useButtonGroup must be used within a ButtonGroup")
  }
  return context
}

interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical"
}

const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, orientation = "horizontal", children, ...props }, ref) => {
    // Check if all children are ButtonGroup components (nested groups)
    const isNested = React.Children.toArray(children).every(
      (child) =>
        React.isValidElement(child) &&
        typeof child.type !== "string" &&
        // @ts-ignore
        child.type?.displayName === "ButtonGroup"
    )

    return (
      <ButtonGroupContext.Provider value={{ orientation }}>
        <div
          ref={ref}
          role="group"
          className={cn(
            "inline-flex",
            {
              "flex-row": orientation === "horizontal" && !isNested,
              "flex-col": orientation === "vertical" && !isNested,
              "gap-2": isNested,
            },
            "[&>button:not(:first-child):not(:last-child)]:rounded-none",
            orientation === "horizontal"
              ? [
                  "[&>button:first-child:not(:last-child)]:rounded-r-none",
                  "[&>button:last-child:not(:first-child)]:rounded-l-none",
                ]
              : [
                  "[&>button:first-child:not(:last-child)]:rounded-b-none",
                  "[&>button:last-child:not(:first-child)]:rounded-t-none",
                ],
            "[&>button:not(:first-child)]:border-l-0",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </ButtonGroupContext.Provider>
    )
  }
)
ButtonGroup.displayName = "ButtonGroup"

interface ButtonGroupSeparatorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical"
}

const ButtonGroupSeparator = React.forwardRef<
  HTMLDivElement,
  ButtonGroupSeparatorProps
>(({ className, orientation: orientationProp, ...props }, ref) => {
  const { orientation: contextOrientation } = useButtonGroup()
  const orientation = orientationProp ?? contextOrientation ?? "horizontal"

  return (
    <div
      ref={ref}
      role="separator"
      className={cn(
        "bg-border",
        orientation === "vertical" ? "h-px w-full" : "w-px h-full",
        className
      )}
      {...props}
    />
  )
})
ButtonGroupSeparator.displayName = "ButtonGroupSeparator"

interface ButtonGroupTextProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
}

const ButtonGroupText = React.forwardRef<HTMLDivElement, ButtonGroupTextProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"

    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex h-9 items-center justify-center whitespace-nowrap px-3 text-sm",
          className
        )}
        {...props}
      />
    )
  }
)
ButtonGroupText.displayName = "ButtonGroupText"

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText }





