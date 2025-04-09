import { create } from 'zustand';
import axios from 'axios';
import { CoreContentModel } from '@/lib/content';

// Add a helper function to sanitize ISO date strings
const sanitizeIsoDate = (dateStr: string | null | undefined): string | undefined => {
  if (!dateStr) return undefined;
  
  // Replace space before timezone with '%2B' (URL-encoded '+')
  if (dateStr.includes(' ') && dateStr.split(':').length >= 2) {
    const parts = dateStr.split(' ');
    if (parts.length === 2 && parts[1].includes(':')) {
      return `${parts[0]}%2B${parts[1]}`;  // Use URL-encoded '+' directly
    }
  }
  
  // Ensure Z is properly handled
  if (dateStr.endsWith('Z')) {
    return dateStr;
  }
  
  // If no timezone info, assume UTC
  if (dateStr.includes('T') && 
      !dateStr.includes('+') && 
      !dateStr.includes('-') && 
      !dateStr.endsWith('Z')) {
    if (dateStr.split(':').length === 2) {
      return `${dateStr}:00%2B00:00`;  // Use URL-encoded '+' 
    } else if (dateStr.split(':').length === 3) {
      return `${dateStr}%2B00:00`;  // Use URL-encoded '+'
    }
  }
  
  // Ensure any existing '+' is properly URL encoded
  if (dateStr.includes('+')) {
    return dateStr.replace(/\+/g, '%2B');  // Replace all '+' with '%2B'
  }
  
  return dateStr;
};

type GeoDataState = {
  // GeoJSON data
  geojsonData: any | null;
  eventGeojsonData: any | null;
  isLoading: boolean;
  error: Error | null;
  selectedLocation: string | null;
  selectedEventType: string | null;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  
  // Active content related to current selected features
  activeContents: CoreContentModel[];
  activeContentLoading: boolean;
  activeContentError: Error | null;
  selectedContentId: string | null;
  
  // Actions
  fetchBaselineGeoJson: (limit?: number) => Promise<any | null>;
  fetchEventGeoJson: (eventType: string, startDate?: string, endDate?: string, limit?: number) => Promise<any | null>;
  setSelectedLocation: (locationName: string | null, contentIds?: string[]) => void;
  setSelectedEventType: (eventType: string | null) => void;
  setDateRange: (startDate: string | null, endDate: string | null) => void;
  fetchContentsByLocation: (locationName: string) => Promise<CoreContentModel[]>;
  fetchContentsByIds: (contentIds: string[]) => Promise<CoreContentModel[]>;
  fetchContentById: (contentId: string) => Promise<CoreContentModel | null>;
  setSelectedContentId: (contentId: string | null) => void;
  clearContents: () => void;
  setActiveContents: (contents: CoreContentModel[]) => void;
};

export const useGeoDataStore = create<GeoDataState>()((set, get) => ({
  // Initial state
  geojsonData: null,
  eventGeojsonData: null,
  isLoading: false,
  error: null,
  selectedLocation: null,
  selectedEventType: null,
  dateRange: {
    startDate: null,
    endDate: null,
  },
  activeContents: [],
  activeContentLoading: false,
  activeContentError: null,
  selectedContentId: null,
  
  // Actions for GeoJSON data
  fetchBaselineGeoJson: async (limit = 100) => {
    set({ isLoading: true, error: null });
    try {
      const params: any = { limit };
      const { startDate, endDate } = get().dateRange;
      
      // Sanitize dates before sending to API
      if (startDate) params.start_date = sanitizeIsoDate(startDate);
      if (endDate) params.end_date = sanitizeIsoDate(endDate);
      
      console.log('Fetching baseline GeoJSON data from API');
      const response = await axios.get('/api/v2/geo/geojson', { params });
      
      set({ 
        geojsonData: response.data, 
        isLoading: false
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching baseline GeoJSON:', error);
      set({ error: error as Error, isLoading: false });
      return null;
    }
  },
  
  fetchEventGeoJson: async (eventType, startDate = undefined, endDate = undefined, limit = 100) => {
    set({ isLoading: true, error: null });
    try {
      const params: any = {
        event_type: eventType,
        limit
      };
      
      // Sanitize dates before sending to API
      if (startDate) params.start_date = sanitizeIsoDate(startDate);
      if (endDate) params.end_date = sanitizeIsoDate(endDate);
      
      console.log(`Fetching event GeoJSON data for ${eventType} from API`);
      const response = await axios.get('/api/v2/geo/geojson_events', { params });
      
      set({ 
        eventGeojsonData: response.data, 
        isLoading: false, 
        selectedEventType: eventType
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching event GeoJSON:', error);
      set({ error: error as Error, isLoading: false });
      return null;
    }
  },
  
  // NEW ACTION: Fetch full content details by multiple IDs
  fetchContentsByIds: async (contentIds) => {
    if (!contentIds || contentIds.length === 0) {
      return [];
    }
    set({ activeContentLoading: true, activeContentError: null });
    try {
      // TODO: Implement this API endpoint in the backend!
      // It should accept a list of IDs (e.g., via request body or query params)
      // and return an array of CoreContentModel objects.
      const response = await axios.post('/api/v2/articles/by_ids', { ids: contentIds }); // Example using POST body
      
      // Ensure the response data is an array
      const fetchedContents = Array.isArray(response.data) ? response.data : [];
      
      // Sort by insertion date (descending) for consistent display
      fetchedContents.sort((a, b) => 
         new Date(b.insertion_date || 0).getTime() - new Date(a.insertion_date || 0).getTime()
      );
      
      set({ 
        activeContents: fetchedContents, 
        activeContentLoading: false 
      });
      return fetchedContents;
    } catch (error) {
      console.error(`Error fetching contents for IDs ${contentIds.join(', ')}:`, error);
      set({ 
        activeContentError: error as Error, 
        activeContentLoading: false,
        activeContents: [] // Clear contents on error
      });
      return [];
    }
  },

  // UPDATED ACTION: Handle location selection (single point, country, or cluster)
  setSelectedLocation: (locationName, contentIds) => {
    // Always update the selected location name for the panel title
    set({ selectedLocation: locationName }); 

    if (contentIds && contentIds.length > 0) {
      // --- Cluster Click --- 
      // Clear previous contents immediately and set loading
      set({ activeContents: [], activeContentLoading: true, activeContentError: null });
      // Fetch full details for the specific content IDs from the cluster
      get().fetchContentsByIds(contentIds);
      
    } else if (locationName) {
      // --- Single Point or Country Click ---
      // Clear previous contents immediately and set loading
      set({ activeContents: [], activeContentLoading: true, activeContentError: null });
      // Fetch contents based on the location name (existing logic)
      get().fetchContentsByLocation(locationName);

    } else {
      // --- Location Deselected --- 
      // Clear everything
      set({ activeContents: [], activeContentLoading: false, selectedLocation: null, activeContentError: null });
    }
  },
  
  setSelectedEventType: (eventType) => {
    set({ selectedEventType: eventType });
  },
  
  setDateRange: (startDate, endDate) => {
    set({ dateRange: { startDate, endDate } });
  },
  
  // Actions for article/content data
  fetchContentsByLocation: async (locationName) => {
    set({ activeContentLoading: true, activeContentError: null });
    try {
      // Encode the location name to handle special characters
      const encodedLocationName = encodeURIComponent(locationName);
      
      try {
        // First try the basic search endpoint
        const response = await axios.get('/api/v2/articles/basic', {
          params: { query: locationName }
        });
        set({ 
          activeContents: response.data.contents, 
          activeContentLoading: false 
        });
        return response.data.contents;
      } catch (basicSearchError) {
        console.warn(`Basic search failed for location ${locationName}, trying entity search:`, basicSearchError);
        
        // If basic search fails, try the entity search as fallback
        const entityResponse = await axios.get('/api/v2/articles/by_entity', {
          params: { entity: encodedLocationName }
        });
        
        set({ 
          activeContents: entityResponse.data.contents || [], 
          activeContentLoading: false 
        });
        return entityResponse.data.contents || [];
      }
    } catch (error) {
      console.error(`Error fetching contents for location ${locationName}:`, error);
      set({ 
        activeContentError: error as Error, 
        activeContentLoading: false,
        activeContents: [] // Clear contents on error to avoid showing stale data
      });
      return [];
    }
  },
  
  fetchContentById: async (contentId) => {
    try {
      const response = await axios.get(`/api/v2/articles/by_id`, {
        params: { id: contentId }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching content with ID ${contentId}:`, error);
      return null;
    }
  },
  
  setSelectedContentId: (contentId) => {
    set({ selectedContentId: contentId });
  },
  
  clearContents: () => {
    set({ activeContents: [], selectedContentId: null });
  },

  // Add the new action implementation
  setActiveContents: (contents) => {
    set({ 
      activeContents: contents, 
      activeContentLoading: false, // Assume loading is finished when contents are set directly
      activeContentError: null 
    });
  }
}));