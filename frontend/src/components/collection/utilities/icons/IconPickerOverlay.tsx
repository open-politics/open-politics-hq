"use client";
import { useState } from "react";
import { IconRenderer, useIconPicker } from "./icon-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AtSymbolIcon } from '@heroicons/react/24/solid';

interface IconPickerDialogProps {
  onIconSelect: (icon: string) => void;
  defaultIcon?: string;
}

export const IconPickerDialog: React.FC<IconPickerDialogProps> = ({ onIconSelect, defaultIcon }) => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<null | string>(defaultIcon || null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-w-[150px] flex justify-center">
          {selected ? (
            <div className="flex items-center gap-2">
              <AtSymbolIcon className="w-4 h-4 text-gray-500" />
              <span className="text-gray-500">Update Icon</span>
            </div>
          ) : (
            "Select Icon"
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select an Icon</DialogTitle>
          <DialogDescription>Choose the best suited icon</DialogDescription>
        </DialogHeader>
        <IconPicker
          onChange={(icon) => {
            setSelected(icon);
            onIconSelect(icon);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

export const IconPicker = ({
  onChange,
}: {
  onChange: (icon: string) => void;
}) => {
  const { search, setSearch, icons } = useIconPicker();

  return (
    <div className="relative">
      <Input
        placeholder="Search..."
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="mt-2 flex h-full max-h-[400px] flex-wrap gap-2 overflow-y-scroll py-4 pb-12">
        {icons.map(({ name, Component }) => (
          <Button
            key={name}
            type="button"
            role="button"
            onClick={() => onChange(name)}
            className="h-11"
          >
            <Component className="!size-6 shrink-0" />
            <span className="sr-only">{name}</span>
          </Button>
        ))}
        {icons.length === 0 && (
          <div className="col-span-full flex grow flex-col items-center justify-center gap-2 text-center">
            <p>No icons found...</p>
            <Button onClick={() => setSearch("")} variant="ghost">
              Clear search
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};