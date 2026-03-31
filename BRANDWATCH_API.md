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

## Integration Strategy for ECO

1. **Ingestion Lambda** polls every 15-30 min using `/data/mentions` endpoint
2. Store raw Brandwatch response in S3 (`eco-raw` bucket)
3. Parse mentions and store in PostgreSQL with both BW sentiment and ECO sentiment (from Claude/Bedrock)
4. Use `/data/volume/days` and `/data/volume/sentiment/days` for aggregate charts (cache in DB)
5. Use `/data/topics` for topic clustering (supplement with Claude analysis)
6. Map mention locations to PR municipalities for geographic view

## Notes

- The AAA - General query is extremely comprehensive (~25 boolean sections) covering brand, officials, infrastructure terms, municipalities, and more
- AI-assisted query creation is available (`booleanQueryCreatedBy: "ai_with_user_edits"`)
- Sentiment classifier version 3 is in use across all queries
- AI consent is given on the account (`aiConsentGiven: true`)
