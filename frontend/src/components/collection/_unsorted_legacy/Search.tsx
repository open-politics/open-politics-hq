import React, { useState, useEffect, useCallback } from 'react';
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from "@/components/ui/button"
import LottieLoader from './LottieLoader';
import { useSearch, SearchType } from '@/hooks/useSearch';
import { CommandItem } from '@/components/ui/command';

interface SearchProps {
  setResults: (results: any) => void;
  setCountry?: (country: string | null) => void;
  setSummary?: (summary: string) => void;
  globeRef: React.RefObject<any>;
}

const Search: React.FC<SearchProps> = ({ setResults, setCountry, setSummary, globeRef }) => {
  const [inputValue, setInputValue] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const providers = [
    {
      name: 'Google Gemini 2.0',
      value: 'gemini',
    },
    {
      name: 'Ollama 7b (unimplemented)',
      value: 'ollama',
    },
  ];

  const searchTypes = [
    {
      name: 'Text',
      value: 'text' as SearchType,
    },
    {
      name: 'Semantic',
      value: 'semantic' as SearchType,
    },
    {
      name: 'Structured',
      value: 'structured' as SearchType,
    },
  ];

  const analysisOptions = [
    { name: 'Conflict Analysis', value: 'Conflict Analysis' },
    { name: 'News Analysis', value: 'News Analysis' },
    { name: 'Economic Analysis', value: 'Economic Analysis' },
  ];

  const [selectedProvider, setSelectedProvider] = useState(providers[0].value);
  const [selectedAnalysisType, setSelectedAnalysisType] = useState('Conflict Analysis');

  const {
    search,
    loading,
    setSearchType,
    setAnalysisType
  } = useSearch(setResults, setCountry, setSummary, globeRef);

  useEffect(() => {
    // Assuming you want to map providers to search types.  Adjust as needed.
    const searchTypeMap: Record<string, SearchType> = {
      'gemini': 'semantic', // Example: Gemini uses semantic search
      'ollama': 'text',   // Example: Ollama uses text search
    };

    setSearchType(searchTypeMap[selectedProvider] || 'semantic'); // Default to semantic
  }, [selectedProvider, setSearchType]);

  useEffect(() => {
    setAnalysisType(selectedAnalysisType);
  }, [selectedAnalysisType, setAnalysisType]);


  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setDialogOpen((open) => !open);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSuggestionSelect = useCallback((query: string) => {
    setInputValue(query);
    search(query);
  }, [search]);

  const handleSearch = useCallback(() => {
    search(inputValue);
  }, [inputValue, search]);

  return (
    <div className="relative w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-xl p-2">
      <h2 className="text-xl mb-2 text-left ml-1">Search news from around the globe</h2>
      {loading && (
        <div className="absolute left-1/4 right-0 flex justify-center top-0">
          <LottieLoader />
        </div>
      )}
      <Command className="mx-auto bg-transparent p-4 rounded-lg">
        <div className="relative">
          <CommandInput
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              }
            }}
            value={inputValue}
            onValueChange={setInputValue}
            placeholder="e.g. Economy of Oman"
            style={{ fontSize: '16px' }}
          />
          <Button
            onClick={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="absolute right-2 top-1/4 sm:top-1 h-8 md:h-8 h-6"
          >
            Search
          </Button>
        </div>

        <div className="absolute right-2 top-1 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setDropdownOpen(!dropdownOpen)}>
                {dropdownOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Analysis Type</DropdownMenuLabel>
              {analysisOptions.map((option) => (
                <DropdownMenuItem key={option.value} onSelect={() => setSelectedAnalysisType(option.value)}>
                  {option.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CommandList className="hidden md:block">
          <CommandGroup heading="Provider">
            <RadioGroup
              defaultValue={selectedProvider}
              onValueChange={(value) => setSelectedProvider(value)}
            >
              {providers.map((provider) => (
                <div key={provider.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={provider.value} id={provider.value} />
                  <Label htmlFor={provider.value}>{provider.name}</Label>
                </div>
              ))}
            </RadioGroup>
          </CommandGroup>

          <CommandGroup heading="Analysis Type">
            <RadioGroup
              defaultValue={selectedAnalysisType}
              onValueChange={(value) => setSelectedAnalysisType(value)}
            >
              {analysisOptions.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={option.value} id={option.value} />
                  <Label htmlFor={option.value}>{option.name}</Label>
                </div>
              ))}
            </RadioGroup>
          </CommandGroup>

        </CommandList>
      </Command>
      <CommandDialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <div className="relative">
          <CommandInput
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            value={inputValue}
            onValueChange={setInputValue}
            placeholder="e.g. Economy of Oman"
            style={{ fontSize: '16px' }}
          />
          <Button onClick={() => handleSearch()} className="absolute right-2 bottom-2 transform -translate-y-1/2" size="sm">Search</Button>
        </div>
        <CommandList>
          <CommandGroup heading="Suggestions">
            <CommandItem onSelect={() => handleSuggestionSelect('The economic situation of South Africa')}>
              {providers.map((provider) => (
                <div key={provider.value}>
                  {provider.name}
                </div>
              ))}
            </CommandItem>
            <CommandItem onSelect={() => handleSuggestionSelect('How has Iran positioned itself towards Ukraine?')}>
              How has Iran positioned itself towards Ukraine
            </CommandItem>
            <CommandItem onSelect={() => handleSuggestionSelect('News from Singapore')}>
              News from Singapore
            </CommandItem>
            <CommandItem onSelect={() => handleSuggestionSelect('Political climate in Brazil')}>
              Political climate in Brazil
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Recent Searches">
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
};

export default Search;
