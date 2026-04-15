# Code Review Prompt for OTH.surf Dashboard

Copy and paste the relevant section below into OpenAI API, Claude, or your preferred code review tool.

---

## Full Codebase Review (All Files)

```
You are reviewing code for OTH.surf, a retro terminal-style surf forecast dashboard for Northern California.

CONTEXT:
- Stack: Node.js/Express backend, vanilla JS/HTML/CSS frontend
- Data sources: Surf-Forecast.com (primary), Stormglass API (backup), Open-Meteo (fallback), NOAA buoys
- Deployment: Render.com with 30-min cache on forecast data

CODING PRINCIPLES (must enforce):
1. THINK BEFORE CODING: No assumptions. State ambiguity explicitly. Push back if a simpler approach exists.
2. SIMPLICITY FIRST: No features beyond what was asked. No abstractions for single-use code. Would a senior engineer call this overcomplicated? If yes, it's wrong.
3. SURGICAL CHANGES: Don't "improve" adjacent code. Match existing style. Every changed line traces directly to the request.
4. GOAL-DRIVEN: Transform vague requirements into testable success criteria. Show test cases, not just fixes.

FILES TO REVIEW:
1. public/app.js (frontend state, rendering, scoring)
2. server.js (API routes, data aggregation, caching)
3. scrapers/surfForecast.js (HTML parsing, combining /latest + /six_day endpoints)
4. scrapers/stormglass.js (API integration with rate limiting)

REVIEW CRITERIA:
- **Correctness**: Bugs? Logic errors? Edge cases (empty data, API failures, timezone mismatches)?
- **Performance**: Unnecessary loops? N+1 queries? Memory leaks? Cache effectiveness?
- **Security**: Exposed secrets? Injection risks (HTML, SQL, command)? Unsafe defaults?
- **Readability**: Unclear variable names? Functions > 40 lines? High cyclomatic complexity?
- **Maintainability**: Testability? Separation of concerns? DRY violations?
- **Data Integrity**: Are timestamps normalized correctly (PDT → UTC)? Do all sources align?

FOR EACH ISSUE FOUND:
1. **Problem**: What's wrong and why it matters
2. **Code location**: File + line number
3. **Suggested fix**: Concrete change with explanation
4. **Severity**: Critical / High / Medium / Low

IGNORE:
- Stylistic preferences (quotes, spacing, naming conventions that already match the codebase)
- Dead code comments or unused internal functions (flag but don't remove)
- "Potential future features" — only review what's actually there

OUTPUT:
- Sort issues by severity
- Limit to top 10 most impactful improvements
- For each, show: problem → fix → impact
```

---

## Frontend-Only Review (app.js)

```
Review public/app.js for the OTH.surf dashboard frontend.

CONTEXT:
- Renders a 5-7 day surf forecast with hourly wave/wind/tide data
- Displays a "stoke meter" verdict (YES/NO + score 0-100)
- Data sources: Surf-Forecast.com (primary), Stormglass (backup), Open-Meteo (fallback)
- Uses canvas animation (pixel surfer on waves)
- No frameworks (vanilla JS, no jQuery, no React)

KEY FUNCTIONS TO EXAMINE:
- render() → orchestrates all UI updates
- getDaySlice() → filters intervals by date
- getBestInterval() → scores all daylight slots, picks best
- computeScore() → verdict algorithm (2-4ft waves, long period, glassy wind = good)
- renderForecastTable() → builds ASCII table from intervals
- normalizeXxxForTable() → converts API responses to uniform shape

REVIEW CRITERIA:
- Are timestamps handled correctly (UTC, PDT conversion)?
- Is the scoring algorithm correct for longboard surfing (2-4ft sweet spot)?
- Does the table render all 7 days correctly?
- Are there any memory leaks (event listeners, DOM refs)?
- Is the "best time today" filtering to daylight hours (6am-8pm)?
- Does it gracefully handle missing data from API failures?

IGNORE:
- Canvas drawing algorithm (pixel placement)
- CSS styling (that's in style.css)

OUTPUT:
- Top 3 bugs or logic errors
- Top 3 performance issues
- Top 2 readability improvements
```

---

## Backend-Only Review (server.js + scrapers)

```
Review server.js, scrapers/surfForecast.js, and scrapers/stormglass.js for the OTH.surf backend.

CONTEXT:
- Node.js/Express API serving 7-day surf forecast
- Combines data from 3+ sources: Surf-Forecast.com (scrape), Stormglass (API), Open-Meteo (API), NOAA (API)
- Data hierarchy: if Surf-Forecast has data, use it; else try Stormglass; else fall back to Open-Meteo
- Rate limits: Stormglass free tier = 10 calls/day (resets every 24h)
- Cache: 30 min TTL on forecast data, 15 min on buoys

KEY FUNCTIONS/ROUTES:
- GET /api/forecast/:spotId → aggregates all sources, returns merged forecast
- GET /api/buoy/:buoyId → real-time wave height from NOAA
- scrapers/surfForecast.js:scrapeSpotForecast() → combines /latest (8/day×3 days) + /six_day (3/day×7 days) endpoints
- scrapers/stormglass.js:getMarineForecast() → calls Stormglass API with rate limiting

REVIEW CRITERIA:
- Rate limiting: Is Stormglass count incremented correctly? Does it skip on limit?
- Data merging: Does mergeIntervals() correctly handle duplicate timestamps?
- Error handling: Do partial failures (one source down) still return usable data?
- Caching: Is cache invalidation working? Are stale timestamps being filtered?
- Scraping: Is the day-to-time mapping correct for both endpoints (8 per day vs 3 per day)?
- Timestamps: Are all sources normalized to UTC/PDT correctly?
- API calls: Are axios timeouts reasonable (12-15s)?

IGNORE:
- HTML parsing regex (cheerio is used, assume it's correct)
- CSS/visual aspects

OUTPUT:
- Any bugs in rate limiting logic
- Issues with data merging or timestamp alignment
- Potential API call failures not handled gracefully
- Performance: unnecessary API calls or inefficient loops?
```

---

## How to Use

1. **Copy the relevant prompt** (Full, Frontend-only, or Backend-only)
2. **Add your code** after the prompt:
   ```
   ---

   [PASTE FILE CONTENTS HERE]
   ```
3. **Send to OpenAI API or Claude**:
   ```bash
   curl https://api.openai.com/v1/chat/completions \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gpt-4",
       "messages": [{"role": "user", "content": "[PASTE ENTIRE PROMPT + CODE]"}]
     }'
   ```

Or use Claude directly via the API with the same prompt structure.

---

## Expected Output Format

```
CRITICAL ISSUES:
1. [Function name] — [Problem]
   Location: [file]:[line]
   Fix: [code change]
   Impact: [why it matters]

HIGH PRIORITY:
2. [Issue]
   ...

MEDIUM:
3. [Issue]
   ...

SUGGESTIONS FOR ELEGANCE:
- [Refactoring idea]
- [Simplification]
```
