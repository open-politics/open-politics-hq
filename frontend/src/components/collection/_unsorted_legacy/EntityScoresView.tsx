import React, { useState, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, TooltipProps } from 'recharts';
import { CalendarDays } from "lucide-react";
import { DateRange } from "react-day-picker";
import { addDays } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { EntityScoreData, EntityScore } from '@/hooks/useEntity';

interface EntityScoresViewProps {
  entity: string;
  fetchEntityScores: (scoreType: string, timeframeFrom: string, timeframeTo: string) => Promise<void>;
  scoreData: EntityScoreData | null;
  isLoading: boolean;
  onDateSelect?: (date: string) => void;
  scoreError?: Error | null;
}

const SCORE_TYPES = [
  { value: 'sociocultural_interest', label: 'Sociocultural Interest' },
  { value: 'global_political_impact', label: 'Global Political Impact' },
  { value: 'regional_political_impact', label: 'Regional Political Impact' },
  { value: 'global_economic_impact', label: 'Global Economic Impact' },
  { value: 'regional_economic_impact', label: 'Regional Economic Impact' },
  { value: 'event_type', label: 'Event Type' },
  { value: 'event_subtype', label: 'Event Subtype' },
  { value: 'keywords', label: 'Keywords' },
  { value: 'categories', label: 'Categories' }
];

const TIME_RANGES = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
  { value: '1y', label: 'Last Year' },
  { value: 'custom', label: 'Custom Range' },
];

const CustomTooltip: React.FC<TooltipProps<number, string>> = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const formattedDate = format(parseISO(label), 'dd MMMM yyyy');
    return (    
      <div className="custom-tooltip p-4 rounded-md shadow-lg border">
        <p className="label font-semibold">{formattedDate}</p>
        <p className="text-sm text-blue-500">
          Average: {payload[0].value?.toFixed(2)}
        </p>
        <p className="text-sm text-green-500">
          Max: {payload[1]?.value?.toFixed(2)}
        </p>
        <p className="text-sm text-red-500">
          Min: {payload[2]?.value?.toFixed(2)}
        </p>
      </div>
    );
  }
  return null;
};

const formatData = (data: EntityScore[]) => {
  if (!data) return [];
  return data.map(item => ({
    date: item.date,
    average_score: item.metrics.average_score,
    min_score: item.metrics.min_score,
    max_score: item.metrics.max_score
  }));
};

export function EntityScoresView({ 
  entity, 
  fetchEntityScores, 
  scoreData, 
  isLoading,
  onDateSelect,
  scoreError
}: EntityScoresViewProps) {
  const [selectedScoreType, setSelectedScoreType] = useState(SCORE_TYPES[0].value);
  const [selectedTimeRange, setSelectedTimeRange] = useState('30d');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: addDays(new Date(), -30),
    to: new Date()
  });

  const handleTimeRangeChange = (value: string) => {
    setSelectedTimeRange(value);
    let from: Date;
    const to = new Date();

    if (value.includes('d')) {
      const days = parseInt(value.replace('d', ''));
      from = addDays(to, -days);
    } else if (value.includes('y')) {
      const years = parseInt(value.replace('y', ''));
      from = addDays(to, -years * 365); // Approximate 1 year as 365 days
    } else {
      from = addDays(to, -30); // Default to 30 days if unrecognized
    }

    setDateRange({ from, to });
  };

  const handleFetchScores = () => {
    if (!dateRange?.from || !dateRange?.to) return;

    fetchEntityScores(
      selectedScoreType,
      format(dateRange.from, 'yyyy-MM-dd'),
      format(dateRange.to, 'yyyy-MM-dd')
    );
  };

  useEffect(() => {
    handleFetchScores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScoreType, dateRange?.from, dateRange?.to]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDateRangeChange = (newDateRange: DateRange | undefined) => {
    setDateRange(newDateRange);
    setSelectedTimeRange('custom');
  };

  const handleChartClick = (data: any) => {
    if (data && data.activeLabel && onDateSelect) {
      onDateSelect(data.activeLabel);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <form onSubmit={handleFormSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Entity Scores for {entity}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-4 flex-wrap">
              <Select value={selectedScoreType} onValueChange={setSelectedScoreType}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select score type" />
                </SelectTrigger>
                <SelectContent>
                  {SCORE_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedTimeRange} onValueChange={handleTimeRangeChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select time range" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map(range => (
                    <SelectItem key={range.value} value={range.value}>
                      {range.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[300px] justify-start text-left font-normal",
                      !dateRange && "text-muted-foreground"
                    )}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "LLL dd, y")} -{" "}
                          {format(dateRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(dateRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={handleDateRangeChange}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>

              <Button 
                type="submit"
                onClick={(e) => e.stopPropagation()}
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>

            {scoreError && (
              <p className="text-center text-red-500">
                {scoreError.message || 'An unexpected error occurred.'}
              </p>
            )}

            {scoreData && scoreData.scores && scoreData.scores.length > 0 ? (
              <div className="highlight-bar-charts" style={{ userSelect: 'none', width: '100%', maxWidth: '100%' }}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={formatData(scoreData.scores)}
                    margin={{
                      top: 5,
                      right: 30,
                      left: 20,
                      bottom: 5,
                    }}
                    onClick={handleChartClick}
                  >
                    {/* <CartesianGrid strokeDasharray="0 0" /> */}
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(date) => format(parseISO(date), 'MM/dd/yyyy')}
                    />
                    <YAxis domain={[0, 10]} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="average_score"
                      stroke="#8884d8"
                      strokeWidth={2}
                      activeDot={{ r: 8 }}
                      connectNulls={true}
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="max_score"
                      stroke="#82ca9d"
                      strokeWidth={1}
                      strokeDasharray="0 0"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="min_score"
                      stroke="#ff7f7f"
                      strokeWidth={1}
                      strokeDasharray="0 0"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              !scoreError && <p className="text-center text-gray-500">No metrics available for the selected range and score type.</p>
            )}
          </CardContent>
        </Card>
      </form>
    </div>
  );
}