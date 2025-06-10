import React from 'react';
import DraggableWrapper from '../../wrapper/draggable-wrapper';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import AnnotationSchemeManager from './AnnotationSchemeManager';

interface DraggableSchemeManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const AnnotationSchemaDraggableManager: React.FC<DraggableSchemeManagerProps> = ({
  isOpen,
  onClose
}) => {
  if (!isOpen) return null;

  // Responsive sizes based on viewport
  const getResponsiveSize = () => {
    if (typeof window === 'undefined') return { width: 800, height: 600 }; // Default for SSR
    
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (vw < 640) { // sm
      return {
        width: Math.min(vw - 32, 400),
        height: Math.min(vh - 32, 500)
      };
    } else if (vw < 1024) { // md
      return {
        width: Math.min(vw - 64, 600),
        height: Math.min(vh - 64, 550)
      };
    } else { // lg and above
      return {
        width: Math.min(vw - 96, 800),
        height: Math.min(vh - 96, 600)
      };
    }
  };

  const responsiveSize = getResponsiveSize();

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm">
      <DraggableWrapper
        title="Annotation Schemas"
        width="w-[800px]"
        height="h-[600px]"
        defaultPosition={{ x: 50, y: 50 }}
        className="z-[101] bg-background"
        onMinimizeChange={(isMinimized) => {
          if (isMinimized) onClose();
        }}
        customSize={responsiveSize}
        headerContent={
          <div className="flex items-center justify-between w-full px-6 py-2 border-b">
            <span className="text-base font-semibold">Annotation Schemas</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        }
      >
        <div className={cn(
          "h-[calc(100%-2rem)]",
          "overflow-hidden",
          "relative",
          "bg-background",
          "flex flex-col",
        )}>
          <AnnotationSchemeManager />
        </div>
      </DraggableWrapper>
    </div>
  );
};

export default AnnotationSchemaDraggableManager; 