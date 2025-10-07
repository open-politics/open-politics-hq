'use server';

import { createStreamableUI } from 'ai/rsc';

export async function getWeather() {
  const weatherUI = createStreamableUI();

  weatherUI.update(<div style={{ color: 'gray' }}>Loading...</div>);

  setTimeout(() => {
    weatherUI.done(<div>It's a sunny day!</div>);
  }, 1000);

  return weatherUI.value;
}