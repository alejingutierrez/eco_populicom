'use client';

import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { SentimentBadge } from '@/components/sentiment-badge';

interface TopicData {
  slug: string;
  name: string;
  count: number;
  topSentiment: string;
  subtopics: Array<{ slug: string; name: string; count: number }>;
}

export default function TopicsPage() {
  const [topics, setTopics] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/topics')
      .then((r) => r.json())
      .then((d) => setTopics(d.topics ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Cargando...</div>;
  }

  const maxCount = Math.max(...topics.map((t) => t.count), 1);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">Tópicos</h1>

      {/* Treemap-like grid */}
      <div className="grid grid-cols-5 gap-3">
        {topics.map((t) => {
          const size = Math.max(0.4, t.count / maxCount);
          return (
            <Card
              key={t.slug}
              className="cursor-pointer transition-colors hover:border-primary"
              style={{ opacity: 0.5 + size * 0.5 }}
            >
              <div className="text-sm font-medium text-foreground">{t.name}</div>
              <div className="mt-1 text-2xl font-bold text-foreground">{t.count}</div>
              <SentimentBadge sentiment={t.topSentiment} className="mt-1" />
            </Card>
          );
        })}
      </div>

      {/* Detailed table */}
      <Card>
        <CardTitle>Detalle por Tópico y Subtópico</CardTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 font-medium">Tópico</th>
                <th className="pb-2 font-medium">Subtópico</th>
                <th className="pb-2 text-right font-medium">Menciones</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <>
                  <tr key={t.slug} className="border-b border-border/50 font-medium text-foreground">
                    <td className="py-2">{t.name}</td>
                    <td className="py-2 text-muted-foreground">—</td>
                    <td className="py-2 text-right">{t.count}</td>
                  </tr>
                  {t.subtopics.map((s) => (
                    <tr key={`${t.slug}-${s.slug}`} className="text-muted-foreground">
                      <td className="py-1.5 pl-4"></td>
                      <td className="py-1.5">{s.name}</td>
                      <td className="py-1.5 text-right">{s.count}</td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
