'use client';

import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { SentimentBadge } from '@/components/sentiment-badge';

interface MunicipalityData {
  slug: string;
  name: string;
  region: string;
  count: number;
  topSentiment: string;
}

export default function GeographyPage() {
  const [municipalities, setMunicipalities] = useState<MunicipalityData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/geography')
      .then((r) => r.json())
      .then((d) => setMunicipalities(d.municipalities ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Cargando...</div>;
  }

  // Group by region
  const byRegion = municipalities.reduce<Record<string, MunicipalityData[]>>((acc, m) => {
    (acc[m.region] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">Geografía</h1>
      <p className="text-sm text-muted-foreground">
        Distribución de menciones por municipio de Puerto Rico
      </p>

      {/* Top municipalities bar */}
      <Card>
        <CardTitle>Top Municipios por Menciones</CardTitle>
        <div className="mt-3 space-y-2">
          {municipalities.slice(0, 10).map((m) => {
            const maxCount = municipalities[0]?.count || 1;
            const pct = (m.count / maxCount) * 100;
            return (
              <div key={m.slug} className="flex items-center gap-3">
                <span className="w-28 text-sm text-foreground">{m.name}</span>
                <div className="flex-1">
                  <div
                    className="h-5 rounded bg-primary/30"
                    style={{ width: `${pct}%` }}
                  >
                    <span className="px-2 text-xs text-foreground">{m.count}</span>
                  </div>
                </div>
                <SentimentBadge sentiment={m.topSentiment} />
              </div>
            );
          })}
        </div>
      </Card>

      {/* By region */}
      <div className="grid grid-cols-2 gap-4">
        {Object.entries(byRegion).map(([region, munis]) => (
          <Card key={region}>
            <CardTitle>
              {region} ({munis.reduce((s, m) => s + m.count, 0)} menciones)
            </CardTitle>
            <div className="mt-2 space-y-1">
              {munis.map((m) => (
                <div key={m.slug} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{m.name}</span>
                  <span className="font-medium text-foreground">{m.count}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
