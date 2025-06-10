import React, { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface AnnotationSchemaCardProps {
  show: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  mode: 'edit' | 'create' | 'watch';
  width?: string;
  height?: string;
  className?: string;
}

export default function AnnotationSchemaCard({
  show,
  onClose,
  title,
  children,
  mode,
  width,
  height,
  className
}: AnnotationSchemaCardProps) {
  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn("sm:max-w-[600px] h-[80vh] flex flex-col", className)}>
        <DialogHeader className="flex items-center justify-between">
          <DialogTitle>{title}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
          </Button>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
          <div className="flex flex-col space-y-4 p-6">
            <p className="text-sm text-muted-foreground">
              {mode === 'create' && "Create a new annotation schema by filling out the details below."}
              {mode === 'edit' && "Use this dialog to edit the annotation schema details."}
              {mode === 'watch' && "View the annotation schema details."}
            </p>
            {children}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
} 