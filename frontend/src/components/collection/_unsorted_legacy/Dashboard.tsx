'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ArticlesView from '@/components/collection/_unsorted_legacy/ContentsView';

interface Article {
  id: string;
  url: string;
  headline: string;
  paragraphs: string;
  source: string;
  insertion_date: string;
  entities: Array<{
    id: string;
    name: string;
    entity_type: string;
    locations: Array<{
      name: string;
      type: string;
      coordinates: number[] | null;
    }>;
  }>;
  tags: Array<{
    id: string;
    name: string;
  }>;
  classification: {
    news_category: string;
    secondary_categories: string[];
    keywords: string[];
    geopolitical_relevance: number;
    legislative_influence_score: number;
    international_relevance_score: number;
    democratic_process_implications_score: number;
    general_interest_score: number;
    spam_score: number;
    clickbait_score: number;
    fake_news_score: number;
    satire_score: number;
  } | null;
}

const scoreFields = [
  "general_interest_score",
  "geopolitical_relevance",
  "legislative_influence_score",
  "international_relevance_score",
  "democratic_process_implications_score"
];

const Dashboard: React.FC = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<Record<string, { min: number; max: number }>>(() =>
    Object.fromEntries(scoreFields.map(field => [field, { min: 0, max: 10 }]))
  );
  const [sortBy, setSortBy] = useState<string>("geopolitical_relevance");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const fetchingRef = useRef(false);

  const formatFilters = useCallback((filters: Record<string, { min: number; max: number }>) => {
    const formattedFilters: Record<string, number> = {};
    for (const [key, value] of Object.entries(filters)) {
      formattedFilters[`min_${key}`] = value.min;
      formattedFilters[`max_${key}`] = value.max;
    }
    return formattedFilters;
  }, []);

  const fetchArticles = useCallback(async (searchQuery: string = '', skip: number = 0) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsLoading(true);
    setError(null); 
    try {
      const formattedFilters = formatFilters(filters);
      const params = new URLSearchParams({
        search_type: 'text',
        skip: skip.toString(),
        limit: '20',
        sort_by: sortBy,
        sort_order: sortOrder,
        filters: JSON.stringify(formattedFilters),
        query: searchQuery
      });
      const response = await fetch(`/api/v1/search/dashboard_articles?${params}`, {
        method: 'GET',
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.detail}`);
      }
  
      const result = await response.json();
      console.log('API Response:', result);
      setArticles(prev => skip === 0 ? result : [...prev, ...result]);
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err instanceof Error ? err : new Error('An error occurred'));
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [filters, sortBy, sortOrder, formatFilters]);

  const testGeojsonFetch = async () => {
    try {
      const response = await fetch('/geojson', {
        method: 'GET',
      });
      if (!response.ok) {
        const errorData = await response.json();
        console.error(`GeoJSON Fetch error! status: ${response.status}, message: ${errorData.detail}`);
      } else {
        const result = await response.json();
        console.log('GeoJSON API Response:', result);
      }
    } catch (err) {
      console.error('GeoJSON Fetch error:', err);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, []); // Empty dependency array

  const handleFilterChange = useCallback((filterName: string, value: { min: number; max: number }) => {
    setFilters(prevFilters => ({
      ...prevFilters,
      [filterName]: value,
    }));
  }, []);

  const handleSearch = useCallback((searchQuery: string) => {
    fetchArticles(searchQuery, 0);
  }, [fetchArticles]);

  const handleLoadMore = useCallback(() => {
    fetchArticles('', articles.length);
  }, [fetchArticles, articles.length]);

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-6 bg-gray-900 text-white rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold">Article Dashboard</h1>
      <Button onClick={testGeojsonFetch} className="bg-highlighted">Test GeoJSON API</Button>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scoreFields.map((field) => (
          <div key={field} className="space-y-2 flex flex-col items-center">
            <label className="text-sm">{field.replace(/_/g, ' ')}</label>
            <div className="flex space-x-2">
              <Input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={filters[field].min}
                onChange={(e) => handleFilterChange(field, { ...filters[field], min: Number(e.target.value) })}
                className="w-20 bg-gray-800 text-white border-gray-700"
              />
              <Input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={filters[field].max}
                onChange={(e) => handleFilterChange(field, { ...filters[field], max: Number(e.target.value) })}
                className="w-20 bg-gray-800 text-white border-gray-700"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex space-x-4">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-gray-800 text-white border-gray-700 rounded"
        >
          {scoreFields.map((field) => (
            <option key={field} value={field}>
              {field.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
          className="bg-gray-800 text-white border-gray-700 rounded"
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>
      {isLoading && <p>Loading...</p>}
      {error && <p>Error: {error.message}</p>}
      <ArticlesView
        locationName=""
        articles={articles}
        isLoading={isLoading}
        error={error}
        fetchArticles={handleSearch}
        loadMore={handleLoadMore}
        resetArticles={() => setArticles([])}
      />
    </div>
  );
};

export default Dashboard;