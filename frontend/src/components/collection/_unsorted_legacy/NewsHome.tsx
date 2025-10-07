import { CircleX } from 'lucide-react';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';

interface NewsHomeProps {
  prompt: string;
  country_focus: any[];
  articles: any[];
  images: any[];
  summary: string;
  topics: any[];
  entities: any[];
}

export const NewsHome: React.FC<NewsHomeProps> = (props) => {
  const fakeArticles = [
    { title: "Breaking News: Market Hits Record Highs", content: "The stock market reached new heights today as investors reacted positively to economic data." },
    { title: "Sports Update: Local Team Wins Championship", content: "In an exciting final match, the local team clinched the championship title in a thrilling overtime victory." },
    { title: "Weather Alert: Severe Storms Expected", content: "Meteorologists are warning of severe storms expected to hit the region later this week. Residents are advised to take precautions." },
    { title: "Technology: New Smartphone Released", content: "The latest smartphone model has been released, featuring cutting-edge technology and innovative new features." },
    { title: "Health: Tips for a Balanced Diet", content: "Experts share their top tips for maintaining a balanced diet and staying healthy in the new year." }
  ];

  const badgeColors = ['bg-blue-700', 'bg-blue-600', 'bg-blue-500', 'bg-blue-400', 'bg-blue-300'];
  return (
    <Card className='absolute h-1/2 left-1/3 overflow-hidden overflow-scroll top-1/2 p-6 shadow-lg rounded-lg'>
      <div>
        <h1 className=' mb-4'>News Home</h1>
        <ul className='space-y-4'>
          {fakeArticles.map((article, index) => (
            <li key={index}>
              <Card className='w-full p-4 shadow-md rounded-md hover:shadow-lg transition-shadow duration-300'>
                <h2 className='mb-2'>{article.title}</h2>
                <p className='text-sm'>{article.content}</p>
                <div className='flex space-x-2 mt-2'>
                  {badgeColors.map((color, badgeIndex) => (
                    <Badge key={badgeIndex} className={`${color} px-2 py-1 rounded-sm`}>
                      Badge {badgeIndex + 1}
                    </Badge>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
};