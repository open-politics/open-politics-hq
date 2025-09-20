'use client';
import { usePathname } from 'next/navigation';
import { motion, useScroll, useTransform, useAnimation, MotionValue } from 'framer-motion';
import { useEffect, useState, useRef } from 'react';

interface DotConfig {
  color: string;
  width: string;
  height: string;
  position?: 'topLeft' | 'bottomRight' | 'center';
}

const BlurredDot = ({ color, x, y, width, height }: {
  color: string,
  x: MotionValue<string> | string,
  y: MotionValue<string> | string,
  width: string,
  height: string
}) => {
  return (
    <motion.div
      className="fixed rounded-full blur-[150px] opacity-40 dark:opacity-20"
      style={{
        backgroundColor: color,
        width: width,
        height: height,
        left: x,
        top: y,
        zIndex: 10,
        pointerEvents: 'none',
      }}
    />
  );
};

const dotsConfig: { [key: string]: DotConfig[] } = {
  '/': [
    { color: 'var(--dot-color-1)', width: '30vw', height: '30vw' },
    { color: 'var(--dot-color-2)', width: '40vw', height: '40vw' },
  ],
  '/blog': [
    { color: 'var(--dot-color-3)', width: '35vw', height: '35vw' },
    { color: 'var(--dot-color-4)', width: '30vw', height: '30vw' },
  ],
  '/webpages/about': [
    { color: 'var(--dot-color-5)', width: '35vw', height: '35vw' },
    { color: 'var(--dot-color-1)', width: '30vw', height: '30vw' },
  ],
  '/accounts/login': [
    { color: 'var(--dot-color-2)', width: '40vw', height: '40vw' },
    { color: 'var(--dot-color-3)', width: '20vw', height: '20vw' },
  ],
  '/documentation': [
    { color: 'var(--dot-color-4)', width: '40vw', height: '40vw' },
    { color: 'var(--dot-color-5)', width: '20vw', height: '20vw' },
  ],
  '/Infospaces': [
    { color: 'var(--dot-color-1)', width: '40vw', height: '40vw' },
    { color: 'var(--dot-color-2)', width: '20vw', height: '20vw' },
  ],
  '/hq/*': [
    { color: 'var(--dot-color-1)', width: '40vw', height: '40vw' },
    { color: 'var(--dot-color-2)', width: '20vw', height: '20vw' },
  ],
  '/webpages/*': [
    { color: 'var(--dot-color-3)', width: '40vw', height: '40vw' },
    { color: 'var(--dot-color-4)', width: '20vw', height: '20vw' },
  ],
  '/hq/infospaces/classification-runner': [
    // if theme = dark, then use var(--dot-color-1), else use a blue color
    { color: 'var(--dot-color-1)', width: '45vw', height: '40vw', position: 'topLeft' },
    { color: 'var(--dot-color-2)', width: '30vw', height: '35vw', position: 'bottomRight' },
    { color: 'var(--dot-color-3)', width: '75vw', height: '20vh', position: 'center' },
  ],
};

const BlurredDots = () => {
  const pathname = usePathname();
  const [dots, setDots] = useState(dotsConfig['/']);
  const { scrollYProgress } = useScroll();
  const controls = useAnimation();
  const containerRef = useRef(null);

  useEffect(() => {
    if (dotsConfig[pathname]) {
      setDots(dotsConfig[pathname]);
    } else {
      const routeGroup = Object.keys(dotsConfig)
        .sort((a, b) => b.length - a.length) // Sort routes by length, longest first
        .find(route => 
          pathname.startsWith(route) && route !== '/'
        );
      if (routeGroup) {
        setDots(dotsConfig[routeGroup]);
      } else {
        setDots(dotsConfig['/']);
      }
    }
  }, [pathname]);

  const topLeftX = useTransform(scrollYProgress, [0, 1], ['-25vw', '-15vw']);
  const topLeftY = useTransform(scrollYProgress, [0, 1], ['-20vh', '100vh']);
  const bottomRightX = useTransform(scrollYProgress, [0, 1], ['100vw', '85vw']);
  const bottomRightY = useTransform(scrollYProgress, [0, 1], ['90vh', '-50vh']);

  // Define positions based on keys
  const positions: { [key: string]: { x: MotionValue<string> | string, y: MotionValue<string> | string } } = {
    topLeft: { x: topLeftX, y: topLeftY },
    bottomRight: { x: bottomRightX, y: bottomRightY },
    center: { x: '12.5vw', y: '40vh' },
  };

  return (
    <>
      {dots.map((dot, index) => {
        const posKey = dot.position || (index === 0 ? 'topLeft' : 'bottomRight'); // Determine the position key
        const pos = positions[posKey];
        // Ensure pos is defined before accessing properties
        if (!pos) return null; // Or handle the error/default case appropriately
        // Pass dot properties including width and height using spread operator
        return <BlurredDot key={index} {...dot} x={pos.x} y={pos.y} />;
      })}
    </>
  );
};

export default BlurredDots;