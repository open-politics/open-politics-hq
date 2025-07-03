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
import { X, FileText, Hash, List, Type, CheckSquare, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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

// Enhanced schema field display component
const FieldTypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'string': return <Type className="h-4 w-4 text-blue-500" />;
    case 'number': 
    case 'integer': return <Hash className="h-4 w-4 text-green-500" />;
    case 'boolean': return <CheckSquare className="h-4 w-4 text-purple-500" />;
    case 'array': return <List className="h-4 w-4 text-orange-500" />;
    case 'object': return <FileText className="h-4 w-4 text-red-500" />;
    default: return <Type className="h-4 w-4 text-gray-500" />;
  }
};

const formatFieldType = (type: string): string => {
  switch (type) {
    case 'string': return 'Text';
    case 'number': return 'Number';
    case 'integer': return 'Integer';
    case 'boolean': return 'True/False';
    case 'array': return 'List';
    case 'object': return 'Object';
    default: return type;
  }
};

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
      <DialogContent className={cn("sm:max-w-[90vw] h-[85vh] flex flex-col", className)}>
        <DialogHeader className="border-b pb-4">
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
        
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6 py-4">
            {children}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
} 