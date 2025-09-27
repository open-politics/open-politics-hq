import { useState, useEffect } from 'react';
import { AnnotationSchemasService, AnnotationSchemaRead } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface UseSchemaInfoReturn {
  schemas: AnnotationSchemaRead[];
  getSchemaById: (id: number) => AnnotationSchemaRead | undefined;
  isLoading: boolean;
  error: string | null;
}

export function useSchemaInfo(): UseSchemaInfoReturn {
  const [schemas, setSchemas] = useState<AnnotationSchemaRead[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activeInfospace } = useInfospaceStore();

  useEffect(() => {
    if (!activeInfospace) {
      setSchemas([]);
      return;
    }

    const fetchSchemas = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await AnnotationSchemasService.listAnnotationSchemas({
          infospaceId: activeInfospace.id,
          includeCounts: false,
          includeArchived: false,
        });
        setSchemas(response.data);
      } catch (err) {
        console.error('Failed to fetch annotation schemas:', err);
        setError('Failed to load schema information');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSchemas();
  }, [activeInfospace]);

  const getSchemaById = (id: number): AnnotationSchemaRead | undefined => {
    return schemas.find(schema => schema.id === id);
  };

  return {
    schemas,
    getSchemaById,
    isLoading,
    error,
  };
}
