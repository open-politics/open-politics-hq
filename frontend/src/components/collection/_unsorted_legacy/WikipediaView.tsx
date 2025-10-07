import React, { useEffect, useRef, useState } from 'react';
import { cn } from "@/lib/utils";

interface WikipediaViewProps {
  locationName: string;
}

const WikipediaView: React.FC<WikipediaViewProps> = ({ locationName }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchWikipediaContent = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(locationName)}`);
        const data = await response.json();
        setContent(data.extract_html || 'No content available');
      } catch (error) {
        console.error('Error fetching Wikipedia content:', error);
        setContent('Failed to load content');
      }
      setIsLoading(false);
    };

    fetchWikipediaContent();
  }, [locationName]);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const element = e.target as HTMLDivElement;
      if (element.scrollHeight - element.scrollTop === element.clientHeight) {
        window.scrollBy({ top: 50, behavior: 'smooth' });
      }
    };

    const contentElement = contentRef.current;
    if (contentElement) {
      contentElement.addEventListener('scroll', handleScroll);
      return () => contentElement.removeEventListener('scroll', handleScroll);
    }
  }, []);

  return (
    <div id="articleWindow" className={cn("max-h-80 md:max-h-128 rounded-lg p-0 pt-2 shadow-sm min-h-36 overflow-hidden")}>
      <div ref={contentRef} className={cn("inner-content h-full overflow-auto")}>
        {isLoading ? (
          <div className="flex justify-center items-center h-full">Loading...</div>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: content }} />
        )}
      </div>
      <style jsx>{`
        .inner-content::-webkit-scrollbar {
          width: 0;
          height: 0;
        }
        .inner-content {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default WikipediaView;