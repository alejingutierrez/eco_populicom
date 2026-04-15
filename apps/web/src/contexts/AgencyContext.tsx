'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

interface Agency {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandwatchProjectId: number | null;
  brandwatchQueryIds: number[] | null;
}

interface AgencyContextValue {
  agencies: Agency[];
  selectedAgency: string;
  setAgency: (slug: string) => void;
  isLoading: boolean;
}

const AgencyContext = createContext<AgencyContextValue>({
  agencies: [],
  selectedAgency: 'aaa',
  setAgency: () => {},
  isLoading: true,
});

export function AgencyProvider({ children }: { children: ReactNode }) {
  const [selectedAgency, setSelectedAgency] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('eco-agency') ?? 'aaa';
    }
    return 'aaa';
  });

  const { data: agencies = [], isLoading } = useQuery<Agency[]>({
    queryKey: ['agencies'],
    queryFn: () => fetch('/api/agencies').then((r) => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const setAgency = (slug: string) => {
    setSelectedAgency(slug);
    if (typeof window !== 'undefined') {
      localStorage.setItem('eco-agency', slug);
    }
  };

  useEffect(() => {
    if (agencies.length > 0 && !agencies.find((a) => a.slug === selectedAgency)) {
      setAgency(agencies[0].slug);
    }
  }, [agencies, selectedAgency]);

  return (
    <AgencyContext.Provider value={{ agencies, selectedAgency, setAgency, isLoading }}>
      {children}
    </AgencyContext.Provider>
  );
}

export function useAgency() {
  return useContext(AgencyContext);
}
