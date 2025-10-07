export async function Weather({ city, unit }: { city: string; unit: string }) {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=${unit === 'C' ? 'metric' : 'imperial'}&appid=YOUR_API_KEY`,
    );
    const data = await response.json();

    if (!data || !data.main || !data.weather) {
      return <div>Loading or data not available...</div>;
    }
  
    return (
      <div>
        <div>Temperature: {data.main.temp ? `${data.main.temp}°${unit}` : 'Data not available'}</div>
        <div>Condition: {data.weather.length > 0 ? data.weather[0].description : 'Data not available'}</div>
      </div>
    );
  }