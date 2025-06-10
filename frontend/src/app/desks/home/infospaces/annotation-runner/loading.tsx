import { Loader2 } from 'lucide-react';

export default function AnnotationRunnerLoading() {
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading Analysis Runner...</p>
      </div>
    </div>
  );
} 