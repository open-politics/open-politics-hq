'use client';

import { useState, useEffect } from 'react';
import { request } from '@/client/core/request';
import { OpenAPI } from '@/client/core/OpenAPI';

export interface SchemaField {
  key: string;
  type: string;
}

export interface SchemaInfo {
  id: number;
  name: string;
  fields: SchemaField[];
}

export interface RunInfo {
  id: number;
  name: string;
  status: string;
  schema_names: string[];
}

export interface QueryFields {
  schemas: SchemaInfo[];
  runs: RunInfo[];
}

export function useQueryFields(infospaceId: number) {
  const [data, setData] = useState<QueryFields | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!infospaceId) return;
    let cancelled = false;
    setIsLoading(true);

    request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/infospaces/{infospace_id}/query/fields',
      path: { infospace_id: infospaceId },
    })
      .then((res: unknown) => {
        if (!cancelled) setData(res as QueryFields);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [infospaceId]);

  return { fields: data, isLoading };
}
