'use client';

import React from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from 'reactflow';
import { cn } from '@/lib/utils';

interface AnimatedEdgeData {
  label?: string;
  itemsPerHour?: number;
  isActive?: boolean;
}

export default function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps<AnimatedEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = data?.isActive;
  const itemsPerHour = data?.itemsPerHour ?? 0;

  return (
    <>
      {/* Background path */}
      <path
        id={`${id}-bg`}
        className="react-flow__edge-path"
        d={edgePath}
        strokeWidth={3}
        stroke={isActive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)'}
        fill="none"
      />
      
      {/* Main path */}
      <path
        id={id}
        className={cn(
          "react-flow__edge-path",
          isActive && "animate-flow-dash"
        )}
        d={edgePath}
        strokeWidth={isActive ? 2 : 1.5}
        stroke={isActive ? '#22c55e' : '#9ca3af'}
        fill="none"
        strokeDasharray={isActive ? '5 5' : undefined}
        markerEnd={markerEnd}
        style={{
          ...style,
          animation: isActive ? 'flowDash 1s linear infinite' : undefined,
        }}
      />
      
      {/* Label with stats */}
      {(data?.label || itemsPerHour > 0) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className={cn(
              "px-1.5 py-0.5 rounded text-[9px] font-medium",
              isActive 
                ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" 
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            )}
          >
            {data?.label || `${itemsPerHour}/hr`}
          </div>
        </EdgeLabelRenderer>
      )}
      
      {/* Global animation styles */}
      <style jsx global>{`
        @keyframes flowDash {
          from {
            stroke-dashoffset: 10;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </>
  );
}
