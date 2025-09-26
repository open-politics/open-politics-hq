import { useState, useCallback } from 'react';
import { SearchService, LocationsService } from '@/client/services';
import { useLocationData } from './useLocationData';
import { useCoordinatesStore } from '@/zustand_stores/storeCoordinates';
import { useArticleTabNameStore } from './useArticleTabNameStore';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
export type SearchType = 'text' | 'semantic' | 'structured';

interface SearchFilters {
  newsCategory?: string;
  secondaryCategories?: string[];
  keyword?: string;
  entities?: string[];
  locations?: string[];
  topics?: string[];
  classificationScores?: Record<string, [number, number]>;
  keywordWeights?: Record<string, number>;
  excludeKeywords?: string[];
}

interface SearchResults {
  tavilyResults: any;
  opolResults: any;
}

interface UseSearchReturn {
  search: (query: string) => Promise<void>;
  loading: boolean;
  error: Error | null;
  results: SearchResults | null;
  summary: string;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  setSearchType: React.Dispatch<React.SetStateAction<SearchType>>;
  setAnalysisType: React.Dispatch<React.SetStateAction<string>>;
}

const calculateZoomLevel = (bbox: number[]): number => {
  if (!bbox || bbox.length !== 4) return 4;

  const width = Math.abs(bbox[2] - bbox[0]);
  const height = Math.abs(bbox[3] - bbox[1]);
  const area = width * height;

  if (area > 400) return 2;
  if (area > 100) return 3;
  if (area > 25) return 4;
  if (area > 5) return 5;
  if (area > 1) return 6;
  return 7;
};

type LocationData = {
  country_name: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  bbox: number[];
  area: number;
  location_type: string;
};

export function useSearch(
  setResults: (results: any) => void,
  setCountry?: (country: string | null) => void,
  setSummary?: (summary: string) => void,
  globeRef?: React.RefObject<any>
): UseSearchReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [searchType, setSearchType] = useState<SearchType>('semantic');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [analysisType, setAnalysisType] = useState('Conflict Analysis');
  const { fetchCoordinates } = useLocationData(null);
  const setCoordinates = useCoordinatesStore((state) => state.setCoordinates);
  const setActiveTab = useArticleTabNameStore((state) => state.setActiveTab);

  const fetchOPOLContents = useCallback(async (query: string) => {
    try {
      const data: any = await SearchService.getContents({
        searchQuery: query,
        limit: 20,
        skip: 0,
      });
      const uniqueArticles = data.contents.reduce((acc: any[], article: any) => {
        if (!acc.find((a: any) => a.id === article.id)) {
          acc.push({
            ...article,
            paragraphs: article.paragraphs || article.content || '',
          });
        }
        return acc;
      }, []);
      return uniqueArticles;
    } catch (error) {
      console.error('Error fetching opol articles:', error);
      return [];
    }
  }, []);

  const fetchLocationFromNLQuery = useCallback(
    async (query: string): Promise<LocationData | null> => {
      try {
        const response = await LocationsService.locationFromQuery({
          query: query,
        });

        const responseData = response as any; // Cast to access data property

        if (responseData?.data) {
          const { coordinates, country_name, bbox, area, location_type } =
            responseData.data;
          const locationData = {
            country_name,
            coordinates: {
              latitude: coordinates[1],
              longitude: coordinates[0],
            },
            bbox,
            area,
            location_type: location_type || 'country',
          };
          console.log('Processed location data:', locationData);
          return locationData;
        } else {
          console.warn('Location data is undefined in response:', response);
          return null;
        }
      } catch (error) {
        console.error('Error in fetchLocationFromNLQuery:', error);
        return null;
      }
    },
    []
  );

  const search = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);

      try {
        const [locationData, opolResults] = await Promise.all([
          fetchLocationFromNLQuery(query),
          fetchOPOLContents(query),
        ]);

        console.log('Location API response:', locationData);
        setActiveTab('summary');

        if (locationData) {
          if (setCountry) {
            setCountry(locationData.country_name);
            setActiveTab('summary');
          }

          if (locationData.coordinates) {
            setCoordinates(
              locationData.coordinates.longitude,
              locationData.coordinates.latitude
            );

            const locationType = locationData.location_type || 'country';

            if (globeRef?.current?.zoomToLocation) {
              let dynamicZoom = 4;
              if (locationData.bbox) {
                dynamicZoom = calculateZoomLevel(locationData.bbox);
              }

              globeRef.current.zoomToLocation(
                locationData.coordinates.latitude,
                locationData.coordinates.longitude,
                locationData.country_name,
                locationData.bbox,
                locationType as 'continent' | 'country' | 'locality',
                dynamicZoom
              );
            }
          }
        }

        const combinedResults = { opolResults };
        setResults(combinedResults);

        if (setSummary) {
          try {
            const google = createGoogleGenerativeAI();
            const llmResult = await generateText({
              model: google('gemini-2.0-flash') as any,
              prompt: `Generate a summary of the following articles: ${opolResults
                .map((article) => article.paragraphs)
                .join('\n')}. Analysis Type: ${analysisType}`,
              system:
                'You are a helpful assistant that generates concise summaries of news articles.',
            });
            setSummary(llmResult.text);
          } catch (summaryError) {
            console.error('Error generating summary:', summaryError);
            setSummary('Failed to generate summary.');
          }
        }
      } catch (err) {
        console.error('Error in search:', err);
        setError(
          err instanceof Error
            ? err
            : new Error('An error occurred during search')
        );
        setActiveTab('articles');
      } finally {
        setLoading(false);
      }
    },
    [
      setResults,
      setSummary,
      setCountry,
      globeRef,
      filters,
      searchType,
      analysisType,
      setActiveTab,
      setCoordinates,
      fetchLocationFromNLQuery,
      fetchOPOLContents,
    ]
  );

  return {
    search,
    loading,
    error,
    results: null,
    summary: '',
    setFilters,
    setSearchType,
    setAnalysisType,
  };
}
