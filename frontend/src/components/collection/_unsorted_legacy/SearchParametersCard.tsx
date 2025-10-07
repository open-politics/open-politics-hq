import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface SearchParametersCardProps {
  onSearch: (params: any) => void;
}

const SearchParametersCard: React.FC<SearchParametersCardProps> = ({ onSearch }) => {
  const [entities, setEntities] = useState('');
  const [locations, setLocations] = useState('');
  const [classificationScores, setClassificationScores] = useState('');
  const [topics, setTopics] = useState('');
  const [keywords, setKeywords] = useState('');
  const [keywordWeights, setKeywordWeights] = useState<{ [key: string]: number }>({});
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [minScore, setMinScore] = useState<number | null>(null);
  const [maxScore, setMaxScore] = useState<number | null>(null);

  const handleSearch = () => {
    const params = {
      entities,
      locations,
      classificationScores,
      topics,
      keywords,
      keywordWeights,
      excludeKeywords,
      minScore,
      maxScore,
    };
    onSearch(params);
  };

  return (
    <Card className="rounded-lg p-4">
      <h4 className="mb-2 text-lg font-semibold">Search Parameters</h4>
      <div className="mb-4">
        <Label htmlFor="entities">Entities</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Entities</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Entities</DialogTitle>
            </DialogHeader>
            <input
              type="text"
              id="entities"
              value={entities}
              onChange={(e) => setEntities(e.target.value)}
              placeholder="Filter by entities (comma-separated)"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="locations">Locations</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Locations</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Locations</DialogTitle>
            </DialogHeader>
            <input
              type="text"
              id="locations"
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
              placeholder="Filter by locations (comma-separated)"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="classification-scores">Classification Scores</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Classification Scores</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Classification Scores</DialogTitle>
            </DialogHeader>
            <input
              type="text"
              id="classification-scores"
              value={classificationScores}
              onChange={(e) => setClassificationScores(e.target.value)}
              placeholder="Filter by classification scores (JSON)"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="topics">Topics</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Topics</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Topics</DialogTitle>
            </DialogHeader>
            <input
              type="text"
              id="topics"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder="Filter by topics (comma-separated)"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="keywords">Keywords</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Keywords</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Keywords</DialogTitle>
            </DialogHeader>
            <input
              type="text"
              id="keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Filter by keywords"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="keyword-weights">Keyword Weights</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Keyword Weights</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Keyword Weights</DialogTitle>
            </DialogHeader>
            <input
              type="text"
              id="keyword-weights"
              value={Object.entries(keywordWeights).map(([key, value]) => `${key}:${value}`).join(', ')}
              onChange={(e) => {
                const weights = e.target.value.split(',').reduce((acc, pair) => {
                  const [key, value] = pair.split(':');
                  acc[key.trim()] = parseFloat(value.trim());
                  return acc;
                }, {} as { [key: string]: number });
                setKeywordWeights(weights);
              }}
              placeholder="Keyword weights (e.g. Berlin:2, Economy:1.5)"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="exclude-keywords">Exclude Keywords</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Exclude Keywords</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Exclude Keywords</DialogTitle>
            </DialogHeader>
            <input
              type="text"
              id="exclude-keywords"
              value={excludeKeywords.join(', ')}
              onChange={(e) => setExcludeKeywords(e.target.value.split(',').map(k => k.trim()))}
              placeholder="Exclude keywords (comma-separated)"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="min-score">Min Score</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Min Score</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Min Score</DialogTitle>
            </DialogHeader>
            <input
              type="number"
              id="min-score"
              value={minScore ?? ''}
              onChange={(e) => setMinScore(e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="Min score"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="mb-4">
        <Label htmlFor="max-score">Max Score</Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">Edit Max Score</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Max Score</DialogTitle>
            </DialogHeader>
            <input
              type="number"
              id="max-score"
              value={maxScore ?? ''}
              onChange={(e) => setMaxScore(e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="Max score"
              className="w-full p-2 border rounded"
            />
          </DialogContent>
        </Dialog>
      </div>
      <Button onClick={handleSearch} className="w-full">Search</Button>
    </Card>
  );
};

export default SearchParametersCard;