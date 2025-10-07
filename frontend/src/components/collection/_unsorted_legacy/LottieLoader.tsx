import React, { useState, useEffect, useRef } from 'react';
import Lottie, { LottieRefCurrentProps } from 'lottie-react';
import { useTheme } from 'next-themes';

const LottieLoader: React.FC = () => {
  const [animationData, setAnimationData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const lottieRef = useRef<LottieRefCurrentProps>(null);
  const { theme } = useTheme();

  useEffect(() => {
    fetch('/animations/brainloader.json')
      .then(response => response.json())
      .then(data => {
        if (theme === 'dark') {
          // Invert colors for dark mode
          data.layers.forEach(layer => {
            if (layer.ty === 4) { // Check if it's a shape layer
              layer.shapes.forEach(shape => {
                if (shape.ty === 'fl') { // Fill type
                  shape.c.k = [1 - shape.c.k[0], 1 - shape.c.k[1], 1 - shape.c.k[2], shape.c.k[3]];
                }
                if (shape.ty === 'st') { // Stroke type
                  shape.c.k = [1 - shape.c.k[0], 1 - shape.c.k[1], 1 - shape.c.k[2], shape.c.k[3]];
                }
              });
            }
          });
        }
        setAnimationData(data);
      })
      .catch(err => {
        console.error('Error loading animation:', err);
        setError('Failed to load animation');
      });
  }, [theme]);

  useEffect(() => {
    if (lottieRef.current) {
      lottieRef.current.setSpeed(2); // Set speed to 2x
    }
  }, [animationData]);

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!animationData) {
    return <div></div>;
  }

  return (
    <div className="flex justify-center items-center bg-transparent mt-0" style={{ width: 100, height: 100 }}>
      <Lottie
        lottieRef={lottieRef}
        animationData={animationData}
        loop={true}
        autoplay={true}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default LottieLoader;