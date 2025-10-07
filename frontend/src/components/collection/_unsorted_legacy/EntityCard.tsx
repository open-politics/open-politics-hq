import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import useEntityImage from '@/hooks/useEntityImage';
import { useEntityData } from '@/hooks/useEntity';
import DotLoader from 'react-spinners/DotLoader';
import ContentCard from './ContentCard';
import WikipediaView from './WikipediaView';
import { Image as LucideImage } from 'lucide-react';
import { EntityScoresView } from './EntityScoresView';
import { format, parseISO } from 'date-fns';
import type { EntityScore } from '@/hooks/useEntity';

interface Entity {
  id: string;
  name: string;
  entity_type: string;
  content_count?: number;
  total_frequency?: number;
  relevance_score?: number;
  locations?: any[];
}

interface EntityCardProps {
  entity: Entity;
  isSelected: boolean;
  onSelect: (name: string | null) => void;
}

const MetricsDisplay: React.FC<{ score: EntityScore }> = ({ score }) => {
  return (
    <div className="bg-transparent">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h5 className="font-semibold">Metrics</h5>
          <p>Average: {score.metrics?.average_score?.toFixed(2) ?? 'N/A'}</p>
          <p>Min: {score.metrics?.min_score?.toFixed(2) ?? 'N/A'}</p>
          <p>Max: {score.metrics?.max_score?.toFixed(2) ?? 'N/A'}</p>
        </div>
        <div>
          <h5 className="font-semibold">Context</h5>
          <p>Articles: {score.context?.article_count ?? 'N/A'}</p>
          <p>Mentions: {score.context?.total_mentions ?? 'N/A'}</p>
          <p>Interest: {score.context?.sociocultural_interest?.toFixed(1) ?? 'N/A'}</p>
          <p>Global Political Impact: {score.context?.global_political_impact?.toFixed(1) ?? 'N/A'}</p>
          <p>Regional Political Impact: {score.context?.regional_political_impact?.toFixed(1) ?? 'N/A'}</p>
          <p>Global Economic Impact: {score.context?.global_economic_impact?.toFixed(1) ?? 'N/A'}</p>
          <p>Regional Economic Impact: {score.context?.regional_economic_impact?.toFixed(1) ?? 'N/A'}</p>
        </div>
        <div>
          <h5 className="font-semibold">Sources & Events</h5>
          <p>{score.context?.sources?.filter(s => s).join(', ') || 'N/A'}</p>
          <p>{score.context?.event_types?.slice(0, 2).join(', ') || 'N/A'}</p>
        </div>
      </div>
    </div>
  );
};

const EntityCard: React.FC<EntityCardProps> = ({ entity, isSelected, onSelect }) => {
  const { imageUrl, loading: imageLoading } = useEntityImage(entity.name);
  const { data, isLoading, error, fetchContents, resetContents, scoreData, isLoadingScores, fetchEntityScores } = useEntityData(entity.name, isSelected);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const getContentDate = (content: any): Date | null => {
    const dateString = content.publication_date || content.insertion_date || content.created_at;
    if (!dateString) return null;
    
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const filteredContents = useMemo(() => {
    if (!data.contents) return [];  // return an empty array if data.contents is falsey
    if (!selectedDate) {
      return data.contents;        // assume data.contents is guaranteed to be an array
    }
    const selectedDateTime = parseISO(selectedDate);
    return data.contents.filter(content => {
      const contentDate = getContentDate(content);
      if (!contentDate) return false;
      
      return format(contentDate, 'yyyy-MM-dd') === format(selectedDateTime, 'yyyy-MM-dd');
    });
  }, [data.contents, selectedDate]);

  useEffect(() => {
    if (isSelected && !scoreData) {
      resetContents();
      fetchContents(0, 20);
    }
  }, [isSelected]);

  const handleCardClick = () => {
    onSelect(isSelected ? null : entity.name);
  };

  const handleInteractiveElementClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDateSelect = (date: string) => {
    console.log('Selected date:', date);
    setSelectedDate(date);
    resetContents();
    fetchContents(0, 20, date);
  };

  return (
    <motion.div
      className={`relative cursor-pointer ${isSelected ? 'col-span-1 md:col-span-2 lg:col-span-3 p-6 border-2 border-blue-500 mx-auto' : 'mx-auto'}`}
      onClick={handleCardClick}
      layout
      transition={{ type: "spring", stiffness: 300, damping: 30, duration: 0.2 }}
    >
      <h3 className="font-bold">{entity.name}</h3>
      {imageLoading ? (
        <p>Loading image...</p>
      ) : imageUrl ? (
        <img src={imageUrl} alt={entity.name} className="rounded-full w-24 h-24 object-cover mx-auto" />
      ) : (
        <div className="rounded-full w-24 h-24 flex items-center justify-center mx-auto">
          <LucideImage size={24} />
        </div>
      )}
      <p className="text-sm text-gray-600">Type: {entity.entity_type}</p>
      <p className="text-sm">Content Count: {entity.content_count}</p>
      <p className="text-sm">Total Frequency: {entity.total_frequency}</p>
      <p className="text-sm">Relevance Score: {entity.relevance_score.toFixed(2)}</p>

      {isSelected && (
        <div className="mt-4" onClick={handleInteractiveElementClick}>
          <WikipediaView locationName={entity.name} />
        </div>
      )}
      
      {isSelected && (
        <div 
          onClick={handleInteractiveElementClick}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <EntityScoresView
            entity={entity.name}
            fetchEntityScores={fetchEntityScores}
            scoreData={scoreData}
            isLoading={isLoadingScores}
            onDateSelect={handleDateSelect}
          />
        </div>
      )}

      {isSelected && (
        <div className="articles-section max-h-[500px] overflow-y-auto" onClick={handleInteractiveElementClick}>
          <h4 className="text-center text-lg font-bold mb-2">
            Articles {selectedDate ? `for ${format(parseISO(selectedDate), 'MMM dd, yyyy')}` : ''}
          </h4>
          {isLoading.contents ? (
            <DotLoader size={50} />
          ) : error.contents ? (
            <p className="text-red-500">{error.contents}</p>
          ) : filteredContents.length === 0 ? (
            <p className="text-center text-gray-500">
              No articles found {selectedDate ? `for ${format(parseISO(selectedDate), 'MMM dd, yyyy')}` : ''}
            </p>
          ) : (
            filteredContents.map((content) => (
              <ContentCard
                key={content.url}
                {...content}
                text_content={content.text_content}
              />
            ))
          )}
        </div>
      )}

      {isSelected && scoreData?.scores?.length > 0 && (
        <div className="mt-4" onClick={handleInteractiveElementClick}>
          <h4 className="text-center text-lg font-bold mb-2">
            Metrics {selectedDate ? `for ${format(parseISO(selectedDate), 'MMM dd, yyyy')}` : ''}
          </h4>
          {selectedDate ? (
            scoreData.scores.find(s => format(parseISO(s.date), 'yyyy-MM-dd') === selectedDate) ? (
              <MetricsDisplay 
                score={scoreData.scores.find(s => format(parseISO(s.date), 'yyyy-MM-dd') === selectedDate)!} 
              />
            ) : (
              <p className="text-center text-gray-500">No metrics available for this date</p>
            )
          ) : (
            scoreData.scores.length > 0 ? (
              <MetricsDisplay score={scoreData.scores[scoreData.scores.length - 1]} />
            ) : (
              <p className="text-center text-gray-500">No metrics available</p>
            )
          )}
        </div>
      )}

    </motion.div>
  );
};

export default EntityCard;
