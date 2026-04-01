'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { SentimentBadge } from '@/components/sentiment-badge';
import { SourceIcon } from '@/components/source-icon';

interface Mention {
  id: string;
  title: string | null;
  snippet: string | null;
  url: string | null;
  domain: string;
  pageType: string;
  author: string | null;
  nlpSentiment: string | null;
  nlpPertinence: string | null;
  nlpEmotions: string[];
  nlpSummary: string | null;
  bwSentiment: string | null;
  likes: number;
  comments: number;
  shares: number;
  engagementScore: number;
  publishedAt: string;
  isDuplicate: boolean;
}

interface Filters {
  sentiment: string;
  source: string;
  pertinence: string;
  search: string;
  page: number;
}

export default function MentionsPage() {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Filters>({
    sentiment: '',
    source: '',
    pertinence: '',
    search: '',
    page: 1,
  });

  const fetchMentions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.sentiment) params.set('sentiment', filters.sentiment);
    if (filters.source) params.set('source', filters.source);
    if (filters.pertinence) params.set('pertinence', filters.pertinence);
    if (filters.search) params.set('search', filters.search);
    params.set('page', String(filters.page));
    params.set('limit', '20');

    try {
      const res = await fetch(`/api/mentions?${params}`);
      const data = await res.json();
      setMentions(data.mentions ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error('Error fetching mentions:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchMentions();
  }, [fetchMentions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Menciones</h1>
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} menciones encontradas
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.sentiment}
          onChange={(e) => setFilters((f) => ({ ...f, sentiment: e.target.value, page: 1 }))}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">Sentimiento: Todos</option>
          <option value="positivo">Positivo</option>
          <option value="neutral">Neutral</option>
          <option value="negativo">Negativo</option>
        </select>

        <select
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value, page: 1 }))}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">Fuente: Todas</option>
          <option value="facebook_public">Facebook</option>
          <option value="twitter">Twitter / X</option>
          <option value="news">Noticias</option>
          <option value="instagram_public">Instagram</option>
        </select>

        <select
          value={filters.pertinence}
          onChange={(e) => setFilters((f) => ({ ...f, pertinence: e.target.value, page: 1 }))}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">Pertinencia: Todas</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>

        <input
          type="text"
          placeholder="Buscar..."
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Mentions List */}
      {loading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">Cargando...</div>
      ) : mentions.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          No se encontraron menciones
        </div>
      ) : (
        <div className="space-y-3">
          {mentions.map((m) => (
            <Card key={m.id} className={m.isDuplicate ? 'opacity-60' : ''}>
              <div className="flex items-start gap-3">
                <SourceIcon pageType={m.pageType} className="mt-1 h-5 w-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground">
                      {m.title || 'Sin título'}
                      {m.isDuplicate && (
                        <span className="ml-2 text-xs text-muted-foreground">[duplicado]</span>
                      )}
                    </h3>
                    <SentimentBadge sentiment={m.nlpSentiment} />
                  </div>

                  {m.nlpSummary && (
                    <p className="mt-1 text-xs text-primary">{m.nlpSummary}</p>
                  )}

                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {m.snippet}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{m.domain}</span>
                    {m.author && <span>por {m.author}</span>}
                    <span>{new Date(m.publishedAt).toLocaleString('es-PR')}</span>
                    {m.engagementScore > 0 && (
                      <span>Engagement: {m.engagementScore.toFixed(0)}</span>
                    )}
                    {m.nlpPertinence && (
                      <span className="rounded bg-accent px-1.5 py-0.5">
                        Pertinencia: {m.nlpPertinence}
                      </span>
                    )}
                    {m.nlpEmotions?.length > 0 && (
                      <span>{m.nlpEmotions.join(', ')}</span>
                    )}
                    {m.url && (
                      <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Ver original
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={filters.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-muted-foreground">
            Página {filters.page} de {Math.ceil(total / 20)}
          </span>
          <button
            disabled={filters.page >= Math.ceil(total / 20)}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
