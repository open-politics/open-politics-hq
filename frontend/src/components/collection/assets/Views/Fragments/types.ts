// Fragment display types

export interface FragmentData {
  value: any;
  source_ref?: string;
  timestamp?: string;
  curated_by_ref?: string;
  schema_id?: number;
  schema?: {
    id: number;
    name: string;
    description?: string;
  };
}

export interface FragmentEntry {
  key: string;
  data: FragmentData;
}

export type FragmentViewMode = 'badge' | 'card' | 'full';

export interface FragmentDisplayProps {
  fragments: Record<string, FragmentData>;
  viewMode?: FragmentViewMode;
  onFragmentClick?: (key: string, fragment: FragmentData) => void;
  onRunClick?: (runId: string) => void;
  className?: string;
}

export interface SingleFragmentProps {
  fragmentKey: string;
  fragment: FragmentData;
  viewMode?: FragmentViewMode;
  onFragmentClick?: () => void;
  onRunClick?: (runId: string) => void;
  className?: string;
}
