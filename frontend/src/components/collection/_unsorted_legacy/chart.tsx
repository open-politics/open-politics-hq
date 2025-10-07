import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { TooltipProps } from 'recharts';

const CustomTooltip: React.FC<TooltipProps<number, string>> = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (    
      <div className="custom-tooltip p-2 bg-opacity-80 shadow-xl backdrop-blur-lg">
        <p className="label">{`Year: ${label}`}</p>
        {payload.map((entry, index) => (
          <p key={index} className={`text-sm ${index % 2 === 0 ? 'text-blue-500' : 'text-green-500'}`}>
            {`${entry.name}: ${entry.value !== null && entry.value !== undefined 
              ? entry.value.toFixed(2) + (entry.name.includes('GROWTH') ? '%' : ' billion $') 
              : 'N/A'}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const EconomicDataChart = ({ data, selectedIndicators }) => {
  console.log('Chart data:', data);
  console.log('Chart selectedIndicators:', selectedIndicators);

  const processedData = useMemo(() => {
    if (!data || data.length === 0 || !selectedIndicators || selectedIndicators.length === 0) return [];
    return data
      .filter(item => item.name !== undefined && item.name !== null)
      .sort((a, b) => parseInt(a.name) - parseInt(b.name))
      .map(item => ({
        ...item,
        ...selectedIndicators.reduce((acc, indicator) => {
          acc[indicator] = item[indicator] !== undefined && item[indicator] !== null 
            ? parseFloat(item[indicator]) 
            : null;
          return acc;
        }, {})
      }));
  }, [data, selectedIndicators]);

  console.log('Processed chart data:', processedData);

  if (processedData.length === 0) {
    return <p>No data available</p>;
  }

  return (
    <div className="highlight-bar-charts" style={{ userSelect: 'none', width: '100%', maxWidth: '100%' }}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={processedData}
          margin={{ top: 5, right: 0, left: 0, bottom: 5 }}
        >
          <XAxis dataKey="name" />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {selectedIndicators.map((indicator, index) => (
            <Line 
              key={indicator}
              yAxisId={indicator.includes('GROWTH') ? "right" : "left"}
              type="monotone" 
              dataKey={indicator} 
              stroke={index % 2 === 0 ? "#8884d8" : "#82ca9d"} 
              activeDot={{ r: 8 }}
              name={indicator}
              connectNulls={true}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default React.memo(EconomicDataChart);