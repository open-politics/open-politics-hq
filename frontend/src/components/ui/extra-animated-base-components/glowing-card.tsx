"use client";
import React, { useState, useEffect } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlowingCardProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  children?: React.ReactNode;
  background?: string;
  darkBackground?: string;
  glowIntensity?: number;
  glowSize?: number;
  glowColor?: string;
  darkGlowColor?: string;
}

const GlowingCard: React.FC<GlowingCardProps> = ({
  className = "",
  width = "100%",
  height = "100%",
  children,
  background = "var(--gradient-primary-light)",
  darkBackground = "var(--gradient-primary-dark)",
  glowIntensity = 0.9,
  glowSize = 80,
  glowColor = "122, 239, 255",
  darkGlowColor = "228, 120, 255",
}) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const scale = useMotionValue(1);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY, currentTarget } = event;
    const { left, top, width, height } = currentTarget.getBoundingClientRect();
    
    // Calculate relative position (0 to 1)
    const x = (clientX - left) / width;
    const y = (clientY - top) / height;
    
    // Add slight tilt effect
    const rotateX = (y - 0.5) * 4; // 4 degree max rotation
    const rotateY = (x - 0.5) * 4;

    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
    currentTarget.style.transform = `perspective(1000px) rotateX(${-rotateX}deg) rotateY(${rotateY}deg)`;
  };

  const handleMouseEnter = () => {
    scale.set(1.02);
  };

  const handleMouseLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    mouseX.set(event.currentTarget.clientWidth / 2);
    mouseY.set(event.currentTarget.clientHeight / 2);
    scale.set(1);
    event.currentTarget.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg)`;
  };

  const glowBackground = useTransform(
    [mouseX, mouseY],
    ([x, y]) => `
      radial-gradient(
        circle at ${x}px ${y}px,
        rgba(${glowColor}, ${glowIntensity}) 0%,
        rgba(${glowColor}, 0) ${glowSize}%
      ),
      ${background}
    `
  );

  const glowDarkBackground = useTransform(
    [mouseX, mouseY],
    ([x, y]) => `
      radial-gradient(
        circle at ${x}px ${y}px,
        rgba(${darkGlowColor}, ${glowIntensity}) 0%,
        rgba(${darkGlowColor}, 0) ${glowSize}%
      ),
      ${darkBackground}
    `
  );

  const sharedMotionProps = {
    className: "w-full h-full rounded-md cursor-pointer relative overflow-hidden transition-all duration-300",
    style: { scale },
    onMouseMove: handleMouseMove,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    transition: { duration: 0.3 },
  };

  return (
    <div className={cn("w-full h-full relative perspective-1000", className)}>
      <motion.div
        {...sharedMotionProps}
        className={`${sharedMotionProps.className} dark:hidden absolute inset-0`}
        style={{ 
          ...sharedMotionProps.style,
          backgroundImage: glowBackground,
          transition: 'transform 0.2s ease-out, background-image 0.3s ease-out, opacity 0.4s ease-out',
          willChange: 'transform, background-image, opacity',
        }}
        initial={{ 
          backgroundImage: background,
          opacity: 0.7
        }}
        animate={{ opacity: 1 }}
      >
        {children}
      </motion.div>

      <motion.div
        {...sharedMotionProps}
        className={`${sharedMotionProps.className} hidden dark:block absolute inset-0`}
        style={{ 
          ...sharedMotionProps.style,
          backgroundImage: glowDarkBackground,
          transition: 'transform 2.2s ease-out, background-image 4.2s ease-out, opacity 0s ease-out',
          willChange: 'transform, background-image, opacity',
        }}
        initial={{ 
          backgroundImage: darkBackground,
          opacity: 0.7
        }}
        animate={{ opacity: 1 }}
      >
        {children}
      </motion.div>
    </div>
  );
};

export default GlowingCard;
