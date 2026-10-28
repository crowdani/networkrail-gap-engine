'use client';

import { useEffect, useState } from 'react';
import { Renew } from '@carbon/icons-react';

interface PageRefreshCountdownProps {
  refreshInterval: number; // in milliseconds
  onRefresh: () => void;
  isPaused?: boolean;
}

export default function PageRefreshCountdown({
  refreshInterval,
  onRefresh,
  isPaused = false,
}: PageRefreshCountdownProps) {
  const [timeLeft, setTimeLeft] = useState(refreshInterval / 1000);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    setTimeLeft(refreshInterval / 1000);

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Reset to 0 to trigger the refresh effect, then will reset to full interval
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [refreshInterval, isPaused]);

  // Separate effect to handle refresh trigger when timeLeft reaches 0
  useEffect(() => {
    if (timeLeft === 0 && !isPaused) {
      setIsRefreshing(true);
      onRefresh();
      setTimeout(() => {
        setIsRefreshing(false);
        setTimeLeft(refreshInterval / 1000);
      }, 1000);
    }
  }, [timeLeft, onRefresh, isPaused, refreshInterval]);

  const progress = ((refreshInterval / 1000 - timeLeft) / (refreshInterval / 1000)) * 100;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        marginTop: '35px',
        marginRight: '10px',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
        Fetching New Data
      </div>
      <div style={{ position: 'relative', width: '40px', height: '40px' }}>
        {/* Background circle */}
        <svg
          width="40"
          height="40"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: 'rotate(-90deg)',
          }}
        >
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke="#e0e0e0"
            strokeWidth="2.5"
          />
        </svg>

        {/* Progress circle */}
        <svg
          width="40"
          height="40"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: 'rotate(-90deg)',
          }}
        >
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke={isRefreshing ? '#24a148' : '#0f62fe'}
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease',
            }}
          />
        </svg>

        {/* Center number */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '0.875rem',
            fontWeight: '600',
            color: '#161616',
            fontFamily: '"IBM Plex Mono", monospace',
          }}
        >
          {isRefreshing ? '•' : timeLeft}
        </div>
      </div>
    </div>
  );
}


