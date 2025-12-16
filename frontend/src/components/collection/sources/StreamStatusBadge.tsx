'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { 
  Radio, 
  Pause, 
  AlertCircle, 
  Loader2,
  Clock
} from 'lucide-react';

interface StreamStatusBadgeProps {
  status: 'active' | 'paused' | 'idle' | 'processing' | 'error' | 'pending';
  className?: string;
  showIcon?: boolean;
}

export function StreamStatusBadge({ 
  status, 
  className,
  showIcon = true 
}: StreamStatusBadgeProps) {
  const statusConfig = {
    active: {
      label: 'Live',
      icon: Radio,
      className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-200 dark:border-green-700',
      pulse: true,
    },
    paused: {
      label: 'Paused',
      icon: Pause,
      className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700',
      pulse: false,
    },
    idle: {
      label: 'Idle',
      icon: Clock,
      className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300 border-gray-200 dark:border-gray-700',
      pulse: false,
    },
    processing: {
      label: 'Processing',
      icon: Loader2,
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-700',
      pulse: false,
      spin: true,
    },
    error: {
      label: 'Error',
      icon: AlertCircle,
      className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-200 dark:border-red-700',
      pulse: false,
    },
    pending: {
      label: 'Pending',
      icon: Clock,
      className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300 border-gray-200 dark:border-gray-700',
      pulse: false,
    },
  };

  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium',
        config.className,
        config.pulse && 'animate-pulse',
        className
      )}
    >
      {showIcon && (
        <Icon 
          className={cn(
            'h-3 w-3',
            (config as any).spin && 'animate-spin'
          )} 
        />
      )}
      <span>{config.label}</span>
    </Badge>
  );
}

