// ============================================================
// ECO Platform — Shared Types
// ============================================================

export type UserRole = 'admin' | 'analyst' | 'viewer';

export type Sentiment = 'negativo' | 'neutral' | 'positivo';

export type Emotion =
  | 'frustración'
  | 'enojo'
  | 'alivio'
  | 'gratitud'
  | 'preocupación'
  | 'sarcasmo'
  | 'indiferencia';

export type Pertinence = 'alta' | 'media' | 'baja';

export type MunicipalitySource = 'brandwatch' | 'nlp';

export type AlertRuleType = 'volume_spike' | 'negative_sentiment' | 'keyword';

// ---- Brandwatch mention (raw from API) ----

export interface BrandwatchMention {
  resourceId: string;
  guid: string | null;
  queryId: number;
  queryName: string;
  title: string | null;
  snippet: string | null;
  url: string | null;
  originalUrl: string | null;
  author: string | null;
  fullname: string | null;
  gender: string | null;
  avatarUrl: string | null;
  domain: string;
  pageType: string;
  contentSource: string | null;
  contentSourceName: string | null;
  pubType: string | null;
  subtype: string | null;
  likes: number;
  comments: number;
  shares: number;
  engagementScore: number;
  impact: number;
  reachEstimate: number;
  potentialAudience: number;
  monthlyVisitors: number;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  cityCode: string | null;
  sentiment: string;
  language: string;
  date: string;
  added: string;
  updated: string;
  mediaUrls: string[];
  matchPositions: Array<{ start: number; text: string; length: number }>;
  // Platform-specific fields (optional)
  facebookLikes?: number;
  facebookComments?: number;
  facebookShares?: number;
  twitterFollowers?: number;
  twitterRetweets?: number;
  twitterReplyCount?: number;
  instagramLikeCount?: number;
  instagramCommentCount?: number;
}

// ---- NLP analysis result from Claude ----

export interface NlpAnalysis {
  sentiment: Sentiment;
  emotions: Emotion[];
  pertinence: Pertinence;
  topics: Array<{
    topic_slug: string;
    subtopic_slug: string | null;
    confidence: number;
  }>;
  municipalities: string[];
  summary: string;
}

// ---- Alert rule config shapes ----

export interface VolumeSpikeConfig {
  type: 'volume_spike';
  threshold: number;
  window_minutes: number;
}

export interface NegativeSentimentConfig {
  type: 'negative_sentiment';
  threshold_pct: number;
  window_hours: number;
}

export interface KeywordConfig {
  type: 'keyword';
  keywords: string[];
  sentiment?: Sentiment;
}

export type AlertConfig =
  | VolumeSpikeConfig
  | NegativeSentimentConfig
  | KeywordConfig;
