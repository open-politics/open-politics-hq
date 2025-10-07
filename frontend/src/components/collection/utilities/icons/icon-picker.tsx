"use client";
import React, { useMemo, useState } from "react";
import * as HeroIcons from "@heroicons/react/24/solid";
import { useTheme } from "next-themes";

type Icons = {
  // the name of the component
  name: string;
  // a more human-friendly name
  friendly_name: string;
  Component: React.FC<React.ComponentPropsWithoutRef<"svg">>;
};

export const useIconPicker = (): {
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  icons: Icons[];
} => {

  const icons: Icons[] = useMemo(
    () =>
      Object.entries(HeroIcons).map(([iconName, IconComponent]) => ({
        name: iconName,
        // split the icon name at capital letters and join them with a space
        friendly_name: iconName.match(/[A-Z][a-z]+/g)?.join(" ") ?? iconName,
        Component: IconComponent,
      })),
    [],
  );

  // these lines can be removed entirely if you're not using the controlled component approach
  const [search, setSearch] = useState("");
  //   memoize the search functionality
  const filteredIcons = useMemo(() => {
    return icons.filter((icon) => {
      if (search === "") {
        return true;
      } else if (icon.name.toLowerCase().includes(search.toLowerCase())) {
        return true;
      } else {
        return false;
      }
    });
  }, [icons, search]);

  return { search, setSearch, icons: filteredIcons };
};

export const IconRenderer = ({
  icon,
  ...rest
}: {
  icon: string;
} & React.ComponentPropsWithoutRef<"svg">) => {
  const { theme } = useTheme();
  const IconComponent = HeroIcons[icon as keyof typeof HeroIcons];

  if (!IconComponent) {
    console.warn(`Icon "${icon}" not found in HeroIcons`);
    return null;
  }

  const iconColor = theme === "dark" ? "text-white" : "text-black";

  return <IconComponent data-slot="icon" className={iconColor} {...rest} />;
};