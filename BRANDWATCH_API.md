# BRANDWATCH_API.md — ECO Platform

## Account Details

- **Client:** Populicom
- **Client ID:** 1997439594
- **Package:** Premium
- **Contact:** Alejandro Gutierrez (agutierrez@populicom.com)
- **CSM:** alicial@brandwatch.com
- **Timezone:** America/Puerto_Rico
- **Shard:** 56

## Authentication

```
POST https://api.brandwatch.com/oauth/token
  ?username={BRANDWATCH_USER}
  &grant_type=api-password
  &client_id=brandwatch-api-client
  &password={BRANDWATCH_PASSWORD}
```

Response: `{ "access_token": "...", "token_type": "bearer", "expires_in": 31535999 }`

Credentials stored in `.env`:
- `BRANDWATCH_USER`
- `BRANDWATCH_PASSWORD`

Token lasts ~1 year. Include as `Authorization: Bearer {token}` header on all requests.

## Rate Limits

- **600 requests** per **10 seconds** (from client tags)
- Implement exponential backoff on 429 responses

## Account Limits

| Limit | Value |
|-------|-------|
| Query limit | 5 |
| Max sampled volume | 30,000 |
| Daily mention export | 10,000 |
| Daily Twitter export | 50,000 |
| Monthly document uploads | 100,000 |
| Custom alerts | 500 |
| Max users | 50 |
| Historical data | 24 months |
| Rolling data | 50 months |
| Twitter channel limit | 50 |
| Non-Twitter channel limit | 50 |

## Projects

### 1. AAA - Autoridad de Acueductos y Alcantarillados
- **Project ID:** 1998403803
- **Created:** 2026-03-04
- **Timezone:** America/Puerto_Rico
- **Purpose:** Social listening for the water/sewer authority of PR

**Queries (3):**

| Query ID | Name | Type | Start Date | Description |
|----------|------|------|-----------|-------------|
| 2003882061 | AAA - General | monitor | 2025-01-01 | Comprehensive query covering AAA brand, water infrastructure, officials, geographic mentions across PR municipalities. Very detailed boolean with 25 sections. |
| 2003911540 | Directas AAA | monitor | 2026-02-01 | Direct mentions of "Autoridad de Acueductos y Alcantarillados (AAA)" |
| 2003910306 | Prueba | monitor | 2026-01-01 | Test query for Francisco Domenech (Sec. Gobernacion / Dir. AAFAF). Location filtered to MEX, ESP, PRI, ARG. |

### 2. Populicom
- **Project ID:** 1998404716
- **Created:** 2026-03-27
- **Timezone:** America/Puerto_Rico
- **Purpose:** Brand monitoring for Populicom itself

**Queries (1):**

| Query ID | Name | Type | Start Date |
|----------|------|------|-----------|
| 2003914448 | Populicom | monitor | 2024-03-01 |

## Available Content Sources

All projects have these sources enabled:
- Twitter/X
- Facebook (public + brand)
- Instagram (public + brand)
- YouTube
- LinkedIn (brand mentions)
- TikTok
- Reddit
- Bluesky
- Threads
- Tumblr
- News
- Blogs
- Forums
- Reviews
- QQ

## Engagement Metrics Available

| Platform | Metrics |
|----------|---------|
| Twitter/X | Likes, Replies, Retweets |
| Facebook | Comments, Likes, Shares |
| Instagram | Comments, Likes |
| YouTube | Comments, Likes |
| LinkedIn | Comments, Likes, Shares |
| TikTok | Comments, Likes, Shares |
| Reddit | Comments, Reddit Score |
| Bluesky | Likes, Quotes, Replies, Reposts |
| Threads | Likes, Quotes, Replies, Reposts, Shares |

## Key API Endpoints for ECO

### Get Mentions (Primary ingestion endpoint)
```
GET /projects/{projectId}/data/mentions
  ?queryId={queryId}
  &startDate={ISO8601}
  &endDate={ISO8601}
  &pageSize=100
  &page=0
  &orderBy=date
  &orderDirection=desc
```

### Get Mention Counts (For charts)
```
GET /projects/{projectId}/data/mentions/count
  ?queryId={queryId}
  &startDate={ISO8601}
  &endDate={ISO8601}
```

### Get Volume Over Time
```
GET /projects/{projectId}/data/volume/days
  ?queryId={queryId}
  &startDate={ISO8601}
  &endDate={ISO8601}
```

### Get Top Topics
```
GET /projects/{projectId}/data/topics
  ?queryId={queryId}
  &startDate={ISO8601}
  &endDate={ISO8601}
```

### Get Sentiment
```
GET /projects/{projectId}/data/volume/sentiment/days
  ?queryId={queryId}
  &startDate={ISO8601}
  &endDate={ISO8601}
```

### Get Top Authors
```
GET /projects/{projectId}/data/volume/topAuthors
  ?queryId={queryId}
  &startDate={ISO8601}
  &endDate={ISO8601}
```

### Get Top Sites
```
GET /projects/{projectId}/data/volume/topSites
  ?queryId={queryId}
  &startDate={ISO8601}
  &endDate={ISO8601}
```

## Modules Available

- ANALYSIS_API
- API2_ACCESS
- AUDIENCE_LISTS
- BRIGHTVIEW
- CUSTOM_CONTENT_API
- DATA_UPLOADS
- INSIGHTS_CENTRAL
- IRIS_TAB_SUMMARY (AI summaries)
- REACT_SCORE
- SEGMENTATION_IA

## Data Analysis (from 2026-03-31 sampling)

### Volume
| Query | 2025 | Q1 2026 | Daily avg (Q1) |
|-------|------|---------|-----------------|
| AAA - General | 58,902 | 16,749 | ~186/day |
| Directas AAA | 0 | 1,382 | ~15/day |

**Decision:** ECO ingests only "Directas AAA" (2003911540) for MVP. ~15 mentions/day.

### Source Distribution (sample of 100 Directas AAA mentions)
| Source | % |
|--------|---|
| Facebook Public | 42% |
| News | 36% |
| Twitter/X | 16% |
| Instagram | 6% |

### Sentiment Distribution (Brandwatch)
| Sentiment | % |
|-----------|---|
| Neutral | 75% |
| Negative | 20% |
| Positive | 5% |

**Key finding:** Brandwatch classifies ~75% as "neutral" but many are clearly negative (complaints about water outages, infrastructure failures). Claude Opus re-analysis provides much more accurate sentiment for PR context.

### Top Themes Identified (from ~200 mention sample)
1. **Averías en bombeo/represas** (61% of sample) — Carraízo failures dominant
2. **Conflictos AAA vs Municipios** — Alcalde San Juan vs AAA
3. **Conflictos AAA vs LUMA** — Energy company blamed for water failures
4. **Calidad del agua / Turbidez**
5. **Infraestructura** — Inauguración de obras, fondos FEMA
6. **Legislación** — Proyectos de ley sobre transparencia
7. **Servicio al cliente** — Depósitos, facturación
8. **Gestión** — Nombramientos, vistas públicas
9. **Emergencias** — Camiones cisterna, contingencias
10. **Medio ambiente** — Embalses, sequía

### Geographic Data Quality
- **49% of mentions** have Brandwatch country = "Puerto Rico"
- **51% have no geo data** from Brandwatch (especially Facebook)
- **NLP extraction** from text recovers municipalities mentioned in snippets (e.g., "sectores de Ponce", "Carraízo en Trujillo Alto")

### Key Fields per Mention (non-null rates)
- `title`: ~80% (Twitter often empty)
- `snippet`: ~95%
- `domain`: 100%
- `sentiment`: 100% (from BW)
- `author`: ~85%
- `country`: ~49%
- `engagementScore`: ~44% > 0
- `mediaUrls`: ~30%

## Integration Strategy (Implemented)

1. **Ingestion Lambda** polls every 5 min using `/data/mentions` endpoint with cursor-based pagination
2. Raw JSON stored in S3 (`eco-raw-863956448838/brandwatch/{queryId}/{date}/`)
3. Each mention sent to SQS ingestion queue (inline, < 256KB per mention)
4. Processor Lambda calls Claude Opus 4.6 via Bedrock for 5 NLP tasks in single prompt
5. Results stored in PostgreSQL: mention + topic associations + municipality associations
6. Negative + high-pertinence mentions pushed to alerts queue

## Notes

- The AAA - General query is extremely comprehensive (~25 boolean sections) but generates too much noise for MVP
- Directas AAA query: `"Autoridad de Acueductos y Alcantarillados (AAA)"` — precise, low noise
- 100% Spanish language mentions
- Brandwatch sentiment v3 classifier undercounts negative sentiment for PR Spanish/Spanglish
- Claude Opus 4.6 provides superior sentiment analysis for cultural context
