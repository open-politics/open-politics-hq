// components/wiki.tsx
'use client';

import React, { useEffect, useState } from 'react';

export default function Wiki({ term }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    async function fetchData() {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${term}`);
      const data = await response.json();
      setData(data);
    }

    fetchData();
  }, [term]);

  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <h1>{data.title}</h1>
      <p>{data.extract}</p>
      {data.thumbnail && <img src={data.thumbnail.source} alt={data.title} />}
      <a href={data.content_urls.desktop.page} target="_blank" rel="noopener noreferrer">Read more</a>
    </div>
  );
}
