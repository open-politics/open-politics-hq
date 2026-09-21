import axios from 'axios';
import type { SearchHistory, SearchHistoriesOut } from '@/lib/types';
import { authHeaders } from '@/lib/authHeaders';

const API_BASE_URL = '/api/v1/search_histories/'; // Ensure trailing slash is present

export const SearchHistoriesService = {
  create: async (searchHistory: Omit<SearchHistory, 'id' | 'user_id'>) => {
    const response = await axios.post<SearchHistory>(`${API_BASE_URL}/create`, searchHistory, {
      headers: {
        ...authHeaders(),
      },
    });
    return response.data;
  },

  list: async (skip: number = 0, limit: number = 100) => {
    const response = await axios.get<SearchHistoriesOut>(`${API_BASE_URL}/read`, {
      params: { skip, limit },
      headers: {
        ...authHeaders(),
      },
    });
    return response.data;
  },
};