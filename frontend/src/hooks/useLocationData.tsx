import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

interface LocationData {
  legislativeData: any[];
  economicData: any[];
  leaderInfo: LeaderInfo | null;
  contents: Content[];
  entities: Entity[];
  contentMetadata?: {
    total: number;
    statistics: ContentStatistics;
  };
  locationMetadata: LocationMetadata;
}

interface ContentStatistics {
  total_articles: number;
  average_relevance: number;
  source_distribution: Record<string, number>;
  date_range: {
    earliest: string | null;
    latest: string | null;
  };
}

interface LeaderInfo {
  state?: string;
  headOfState?: string;
  headOfStateImage?: string | null;
  headOfGovernment?: string;
  headOfGovernmentImage?: string | null;
}

interface Entity {
  name: string;
  entity_type: string;
  article_count: number;
  total_frequency: number;
  relevance_score: number;
}

interface Content {
  id: string;
  datasource_id?: number;
  url: string;
  title: string | null;
  content_type: string;
  source: string | null;
  insertion_date: string;
  text_content: string | null;
  publication_date: string | null;
  content_language?: string | null;
  author?: string | null;
  relevance_metrics: RelevanceMetrics;
  entities: Entity[];
  tags: Tag[];
  evaluation: ContentEvaluation;
}

interface RelevanceMetrics {
  entity_count: number;
  location_mentions: number;
  total_frequency: number;
  relevance_score: number;
}

interface Tag {
  // Define tag properties
}

interface ContentEvaluation {
  sociocultural_interest: number | null;
  global_political_impact: number | null;
  regional_political_impact: number | null;
  global_economic_impact: number | null;
  regional_economic_impact: number | null;
  event_type: string | null;
  event_subtype: string | null;
  keywords: string[] | null;
  categories: string[] | null;
}

interface ContentResponse {
  location: string;
  total_results: number;
  skip: number;
  limit: number;
  contents: Content[];
  statistics: ContentStatistics;
}

interface FetchContentsParams {
  skip?: number;
  dateFrom?: string;
  dateTo?: string;
  contentType?: string;
  minRelevance?: number;
}

interface LocationMetadata {
  isOECDCountry: boolean;
  isLegislativeEnabled: boolean;
}

export function useLocationData(locationName: string | null) {
  const [data, setData] = useState<LocationData>({
    legislativeData: [],
    economicData: [],
    leaderInfo: null,
    contents: [],
    entities: [],
    locationMetadata: {
      isOECDCountry: false,
      isLegislativeEnabled: false,
    },
  });

  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({
    legislative: false,
    economic: false,
    leaderInfo: false,
    contents: false,
    entities: false,
  });

  const [error, setError] = useState<Record<string, Error | null>>({
    legislative: null,
    economic: null,
    leaderInfo: null,
    contents: null,
    entities: null,
  });

  const mapLeaderInfo = (rawData: any): LeaderInfo => ({
    state: rawData.State,
    headOfState: rawData['Head of State'],
    headOfStateImage: rawData['Head of State Image'],
    headOfGovernment: rawData['Head of Government'],
    headOfGovernmentImage: rawData['Head of Government Image'],
  });

  const genericFetch = useCallback(
    async <T,>(dataType: keyof LocationData, url: string, mapper?: (data: any) => T) => {
      if (!locationName) return;

      setIsLoading((prev) => ({ ...prev, [dataType]: true }));
      try {
        const response = await axios.get(url, {
          params: { query: locationName },
        });
        const fetchedData: T = mapper ? mapper(response.data) : response.data;
        setData((prev) => ({ ...prev, [dataType]: fetchedData }));
      } catch (err) {
        setError((prev) => ({
          ...prev,
          [dataType]: err instanceof Error ? err : new Error(`Error fetching ${dataType}`),
        }));
      } finally {
        setIsLoading((prev) => ({ ...prev, [dataType]: false }));
      }
    },
    [locationName]
  );

  const fetchContents = useCallback(
    async ({ skip = 0 }: FetchContentsParams = {}) => {
      if (!locationName) return;

      setIsLoading((prev) => ({ ...prev, contents: true }));
      try {
        const response = await axios.get<ContentResponse>('/api/v2/articles/by_entity/', {
          params: {
            entity: encodeURIComponent(locationName),
            skip,
            limit: 20,
          },
        });

        setData((prev) => ({
          ...prev,
          contents: skip === 0 ? response.data.contents : [...prev.contents, ...response.data.contents],
          contentMetadata: response.data.statistics ? { statistics: response.data.statistics, total: response.data.total_results } : prev.contentMetadata,
        }));

        return response.data;
      } catch (err) {
        setError((prev) => ({ ...prev, contents: err as Error }));
      } finally {
        setIsLoading((prev) => ({ ...prev, contents: false }));
      }
    },
    [locationName]
  );

  const resetContents = useCallback(() => {
    setData((prev) => ({ ...prev, contents: [] }));
  }, []);

  const fetchEntities = useCallback(
    async (query: string, skip: number, limit: number) => {
      if (!locationName) return;

      setIsLoading((prev) => ({ ...prev, entities: true }));
      try {
        const response = await axios.get('/api/v2/entities/by_entity', {
          params: {
            entity: encodeURIComponent(query),
            skip,
            limit
          },
        });

        setData((prev) => ({
          ...prev,
          entities: skip === 0 ? response.data : [...prev.entities, ...response.data],
        }));
      } catch (err) {
        setError((prev) => ({ ...prev, entities: err as Error }));
      } finally {
        setIsLoading((prev) => ({ ...prev, entities: false }));
      }
    },
    [locationName]
  );

  const fetchCoordinates = useCallback(async (query: string) => {
    try {
      const response = await axios.get('/api/v2/classification/location_from_query', {
        params: { query },
      });
      if (response.data.error) return null;
      return { longitude: response.data.longitude, latitude: response.data.latitude };
    } catch (err) {
      console.error('Error fetching coordinates:', err);
      return null;
    }
  }, []);

  const fetchLocationMetadata = useCallback(async () => {
    if (!locationName) return;

    try {
      const response = await axios.get<LocationMetadata>(`/api/v1/locations/metadata/${encodeURIComponent(locationName)}`);
      setData((prev) => ({ ...prev, locationMetadata: response.data }));
    } catch (err) {
      console.error('Error fetching location metadata:', err);
    }
  }, [locationName]);

  const fetchEconomicData = useCallback(async () => {
    if (!locationName || !data.locationMetadata.isOECDCountry) return;

    await genericFetch<any[]>('economicData', `/api/v1/locations/econ_data/${encodeURIComponent(locationName)}`);
  }, [locationName, data.locationMetadata.isOECDCountry, genericFetch]);

  useEffect(() => {
    if (locationName) {
      fetchLocationMetadata();
      fetchContents({ skip: 0 });
      genericFetch('legislativeData', `/api/v1/locations/legislation/${encodeURIComponent(locationName)}`);
      genericFetch('leaderInfo', `/api/v1/locations/leaders/${encodeURIComponent(locationName)}`, mapLeaderInfo);
      fetchEntities(locationName, 0, 50);
    }
  }, [locationName, fetchContents, genericFetch, fetchEntities, fetchLocationMetadata]);

  return {
    data,
    isLoading,
    error,
    fetchContents,
    resetContents,
    fetchEntities,
    fetchCoordinates,
    fetchEconomicData,
    getContentStatistics: useCallback(() => data.contentMetadata?.statistics || null, [data.contentMetadata]),
  };
}

export function mapLabelToStatus(label: string): string {
  const statusMap: Record<string, string> = {
    red: 'rejected',
    yellow: 'pending',
    green: 'accepted',
  };
  return statusMap[label] || 'unknown';
}