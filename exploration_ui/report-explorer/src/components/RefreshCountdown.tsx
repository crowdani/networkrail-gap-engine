'use client';

import { useEffect, useState } from 'react';
import { Renew } from '@carbon/icons-react';

interface RefreshCountdownProps {
  isRefreshing: boolean;
  totalSteps?: number;
  currentStep?: number;
  onComplete?: () => void;
}

export default function RefreshCountdown({
  isRefreshing,
  totalSteps = 3,
  currentStep = 0,
  onComplete,
}: RefreshCountdownProps) {
  const [progress, setProgress] = useState(0);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!isRefreshing) {
      setProgress(0);
      setRotation(0);
      return;
    }

    // Calculate progress based on current step
    const stepProgress = ((currentStep + 1) / totalSteps) * 100;
    setProgress(stepProgress);

    // Animate rotation
    const rotationInterval = setInterval(() => {
      setRotation((prev) => (prev + 2) % 360);
    }, 16); // ~60fps

    return () => clearInterval(rotationInterval);
  }, [isRefreshing, currentStep, totalSteps]);

  useEffect(() => {
    if (progress >= 100 && onComplete) {
      const timeout = setTimeout(onComplete, 500);
      return () => clearTimeout(timeout);
    }
  }, [progress, onComplete]);

  if (!isRefreshing) return null;

  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div
      style={{
        position: 'fixed',
        top: '80px',
        right: '2rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        background: 'rgba(255, 255, 255, 0.98)',
        padding: '1rem',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        border: '1px solid #e0e0e0',
        fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Spinner with countdown */}
      <div style={{ position: 'relative', width: '48px', height: '48px' }}>
        {/* Background circle */}
        <svg
          width="48"
          height="48"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: 'rotate(-90deg)',
          }}
        >
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke="#e0e0e0"
            strokeWidth="3"
          />
        </svg>

        {/* Progress circle */}
        <svg
          width="48"
          height="48"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: 'rotate(-90deg)',
          }}
        >
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke="#0f62fe"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 0.3s ease',
            }}
          />
        </svg>

        {/* Rotating icon */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Renew size={20} style={{ color: '#0f62fe' }} />
        </div>

        {/* Step counter */}
        <div
          style={{
            position: 'absolute',
            bottom: '-6px',
            right: '-6px',
            background: '#0f62fe',
            color: 'white',
            borderRadius: '50%',
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.625rem',
            fontWeight: '600',
            border: '2px solid white',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
          }}
        >
          {currentStep + 1}
        </div>
      </div>

      {/* Status text */}
      <div
        style={{
          fontSize: '0.75rem',
          color: '#525252',
          textAlign: 'center',
          lineHeight: '1.3',
          maxWidth: '120px',
        }}
      >
        <div style={{ fontWeight: '600', color: '#161616', marginBottom: '2px' }}>
          Refreshing
        </div>
        <div>
          Step {currentStep + 1} of {totalSteps}
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: '100%',
          height: '3px',
          background: '#e0e0e0',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            background: '#0f62fe',
            width: `${progress}%`,
            transition: 'width 0.3s ease',
            borderRadius: '2px',
          }}
        />
      </div>
    </div>
  );
}


