import { useState } from 'react';
import axios from 'axios';
import { useProvidersStore } from '@/zustand_stores/storeProviders';

interface GeocodeResult {
  longitude: number;
  latitude: number;
  bbox?: [number, number, number, number];
  type?: 'continent' | 'country' | 'locality' | 'region' | 'city' | 'address';
}

export type { GeocodeResult };

const useGeocode = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selections, apiKeys } = useProvidersStore();
  
  // Get active geocoding provider
  const activeGeocodingProvider = selections.geocoding?.providerId || 'nominatim_local';

  const geocodeLocation = async (location: string): Promise<GeocodeResult | null> => {
    setLoading(true);
    setError(null);
    console.log(`Starting geocode for location: ${location} with provider: ${activeGeocodingProvider}`);
    try {
      // Check if we need to pass API key for this provider
      const providerApiKey = apiKeys[activeGeocodingProvider];
      
      // Use default endpoint (handles fallback automatically) or provider-specific endpoint
      const response = await axios.get('/api/v1/utils/geocode_location', {
        params: { 
          location,
          // If user has overridden with their own key, we could add provider_type and api_key params
          // For now, the backend uses the default configured provider with env fallback
        }
      });
      console.log('Response received:', response.data);
      
      // Extract all relevant data from the response
      const { coordinates, bbox, location_type } = response.data;
      const longitude = coordinates?.[0];
      const latitude = coordinates?.[1];
      
      // Convert bbox strings to numbers (backend returns strings)
      const convertedBbox = bbox && Array.isArray(bbox) && bbox.length === 4
        ? [parseFloat(bbox[0]), parseFloat(bbox[1]), parseFloat(bbox[2]), parseFloat(bbox[3])] as [number, number, number, number]
        : undefined;
      
      return {
        longitude,
        latitude,
        bbox: convertedBbox,
        type: location_type
      };
    } catch (err) {
      setError('Failed to geocode location');
      console.error('Geocoding error:', err);
      if (axios.isAxiosError(err)) {
        console.error('Axios error:', err.response?.data);
      }
      return null;
    } finally {
      setLoading(false);
      console.log(`Finished geocode for location: ${location}`);
    }
  };

  return { geocodeLocation, loading, error };
};

export default useGeocode;
