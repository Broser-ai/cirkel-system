import React, { useEffect, useState, useRef } from 'react';

interface AnimatedCountProps {
  value: number;
  duration?: number; // duration in ms
  decimals?: number;
}

export default function AnimatedCount({ value, duration = 1200, decimals = 0 }: AnimatedCountProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
    let startTimestamp: number | null = null;
    const startValue = 0;
    const endValue = value;

    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      
      // Easing function (easeOutQuad)
      const easeProgress = progress * (2 - progress);
      
      const current = easeProgress * (endValue - startValue) + startValue;
      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        setDisplayValue(endValue);
      }
    };

    animationFrameId = window.requestAnimationFrame(step);

    return () => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [value, duration]);

  // Format to Danish locale
  const formatted = displayValue.toLocaleString('da-DK', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return <span id={`animated-count-val-${value.toString().replace('.', '-')}`}>{formatted}</span>;
}
