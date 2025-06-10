'use client';

import React from 'react';
import AssetManager from '../AssetManager';
import DraggableWrapper from '../../../wrapper/draggable-wrapper';
import { X, Maximize2, Square, Layout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import AssetDetailProvider from '../Views/AssetDetailProvider';

interface DraggableAssetManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

const DraggableAssetManager: React.FC<DraggableAssetManagerProps> = ({
  isOpen,
  onClose,
  onLoadIntoRunner
}) => {
  // Responsive sizing logic
  const getResponsiveSize = () => {
    if (typeof window !== 'undefined') {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      if (width <= 768) { // Mobile
        return {
          width: Math.floor(width * 0.95),
          height: Math.floor(height * 0.85),
        };
      } else if (width <= 1024) { // Tablet
        return {
          width: Math.floor(width * 0.90),
          height: Math.floor(height * 0.80),
        };
      } else { // Desktop
        return {
          width: Math.floor(width * 0.85),
          height: Math.floor(height * 0.85),
        };
      }
    }
    return {
      width: 1200,
      height: 800,
    };
  };

  const [responsiveSize, setResponsiveSize] = React.useState(getResponsiveSize());
  const [layoutMode, setLayoutMode] = React.useState<'default' | 'wide' | 'tall'>('default');

  React.useEffect(() => {
    const handleResize = () => {
      setResponsiveSize(getResponsiveSize());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLayoutChange = (layout: 'default' | 'wide' | 'tall') => {
    setLayoutMode(layout);
    
    const baseSize = getResponsiveSize();
    let newSize = { ...baseSize };
    
    if (typeof window !== 'undefined') {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      switch (layout) {
        case 'wide':
          newSize.width = Math.floor(width * 0.95);
          break;
        case 'tall':
          newSize.height = Math.floor(height * 0.90);
          break;
        default:
          // Keep base size
          break;
      }
    }
    
    setResponsiveSize(newSize);
  };

  if (!isOpen) return null;

  return (
    <AssetDetailProvider>
      <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm">
        <DraggableWrapper
          title="Bundle Manager"
          width="w-[1200px]"
          height="h-[800px]"
          defaultPosition={{ x: 50, y: 50 }}
          className="z-[101] bg-background"
          onMinimizeChange={(isMinimized) => {
            if (isMinimized) onClose();
          }}
          customSize={responsiveSize}
          headerContent={
            <div className="flex items-center justify-between w-full px-6 py-2 border-b">
              <span className="text-base font-semibold">Bundle Manager</span>
              <div className="flex items-center space-x-2">
                <div className="flex items-center mr-4 space-x-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-muted"
                    onClick={() => handleLayoutChange('default')}
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-muted"
                    onClick={() => handleLayoutChange('wide')}
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-muted"
                    onClick={() => handleLayoutChange('tall')}
                  >
                    <Layout className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-8 w-8 hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          }
        >
          <div 
            className={cn(
              "overflow-hidden p-0 m-0",
              responsiveSize.width,
              responsiveSize.height
            )}
          >
            <AssetManager onLoadIntoRunner={onLoadIntoRunner} />
          </div>
        </DraggableWrapper>
      </div>
    </AssetDetailProvider>
  );
};

export default DraggableAssetManager;