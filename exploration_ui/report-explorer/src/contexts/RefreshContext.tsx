'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface RefreshContextType {
  isRefreshing: boolean;
  currentStep: number;
  totalSteps: number;
  startRefresh: () => void;
  updateStep: (step: number) => void;
  completeRefresh: () => void;
}

const RefreshContext = createContext<RefreshContextType | undefined>(undefined);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 3;

  const startRefresh = () => {
    setIsRefreshing(true);
    setCurrentStep(0);
  };

  const updateStep = (step: number) => {
    setCurrentStep(step);
  };

  const completeRefresh = () => {
    setIsRefreshing(false);
    setCurrentStep(0);
  };

  return (
    <RefreshContext.Provider
      value={{
        isRefreshing,
        currentStep,
        totalSteps,
        startRefresh,
        updateStep,
        completeRefresh,
      }}
    >
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  const context = useContext(RefreshContext);
  if (context === undefined) {
    throw new Error('useRefresh must be used within a RefreshProvider');
  }
  return context;
}


