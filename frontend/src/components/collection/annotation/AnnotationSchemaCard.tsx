import React, { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";

interface AnnotationSchemaCardProps {
  show: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  mode: 'edit' | 'create' | 'watch';
  className?: string;
  disableScrollArea?: boolean;
}

export default function AnnotationSchemaCard({
  show,
  onClose,
  title,
  children,
  mode,
  className,
  disableScrollArea = false,
}: AnnotationSchemaCardProps) {
  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn("sm:max-w-[90vw] h-[85vh] flex flex-col", className)}>
        <DialogHeader className="border-b pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {mode === 'create' && "Create a new annotation schema"}
                {mode === 'edit' && "Edit annotation schema details"}
                {mode === 'watch' && "Schema structure and field details"}
              </p>
            </div>
          </div>
        </DialogHeader>

        {disableScrollArea ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 py-4">
              {children}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
