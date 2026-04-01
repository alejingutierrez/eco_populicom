'use client';

import { useState, useEffect, useCallback } from 'react';
import { EcoFilterBar } from '@/components/ui/EcoFilterBar';
import { EcoMentionsTable } from '@/components/data-display/EcoMentionsTable';

interface ApiMention {
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

interface ApiResponse {
  mentions: ApiMention[];
  total: number;
}

interface TableMention {
  id: string;
  title: string | null;
  full_text: string | null;
  url: string | null;
  domain: string;
  page_type: string;
  author: string | null;
  sentiment: string | null;
  pertinence: string | null;
  bw_sentiment: string | null;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
  published_at: string;
}

function mapMention(m: ApiMention): TableMention {
  return {
    id: m.id,
    title: m.title,
    full_text: m.snippet,
    url: m.url,
    domain: m.domain,
    page_type: m.pageType,
    author: m.author,
    sentiment: m.nlpSentiment,
    pertinence: m.nlpPertinence,
    bw_sentiment: m.bwSentiment,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    engagement: m.engagementScore,
    published_at: m.publishedAt,
  };
}

const PAGE_SIZE = 20;

export default function MentionsPage() {
  const [sentiment, setSentiment] = useState('');
  const [source, setSource] = useState('');
  const [pertinence, setPertinence] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<TableMention[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchMentions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sentiment) params.set('sentiment', sentiment);
      if (source) params.set('source', source);
      if (pertinence) params.set('pertinence', pertinence);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));

      const res = await fetch(`/api/mentions?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch mentions');

      const json: ApiResponse = await res.json();
      setData(json.mentions.map(mapMention));
      setTotal(json.total);
    } catch {
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [sentiment, source, pertinence, search, page]);

  useEffect(() => {
    fetchMentions();
  }, [fetchMentions]);

  const handleSentimentChange = useCallback((value: string) => {
    setSentiment(value);
    setPage(1);
  }, []);

  const handleSourceChange = useCallback((value: string) => {
    setSource(value);
    setPage(1);
  }, []);

  const handlePertinenceChange = useCallback((value: string) => {
    setPertinence(value);
    setPage(1);
  }, []);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  return (
    <>
      <EcoFilterBar
        sentimentValue={sentiment}
        sourceValue={source}
        pertinenceValue={pertinence}
        onSentimentChange={handleSentimentChange}
        onSourceChange={handleSourceChange}
        onPertinenceChange={handlePertinenceChange}
        onSearch={handleSearch}
      />
      <EcoMentionsTable
        data={data}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
      />
    </>
  );
}
