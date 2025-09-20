"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { SidebarMenuButton } from "@/components/ui/sidebar"

export function ModeSwitcher() {
  const { setTheme, resolvedTheme } = useTheme()

  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  return (
    <SidebarMenuButton
      onClick={toggleTheme}
      tooltip={{
        children: `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`,
      }}
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span className="hidden dark:block dark:text-white">Dark Mode</span>
      <span className="block dark:hidden text-black">Light Mode</span>
    </SidebarMenuButton>
  )
}

export default ModeSwitcher;