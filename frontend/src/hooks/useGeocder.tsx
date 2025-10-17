import { useState } from 'react';
import axios from 'axios';

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

  const geocodeLocation = async (location: string): Promise<GeocodeResult | null> => {
    setLoading(true);
    setError(null);
    console.log(`Starting geocode for location: ${location}`);
    try {
      const response = await axios.get('/api/v1/utils/geocode_location', {
        params: { location }
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
