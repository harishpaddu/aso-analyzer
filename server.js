require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const gplay = require('google-play-scraper').default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function extractPackageId(input) {
  if (!input) return null;
  const m = input.match(/id=([a-zA-Z0-9._]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z][a-zA-Z0-9._]+\.[a-zA-Z][a-zA-Z0-9._]+$/.test(input.trim())) return input.trim();
  return null;
}

async function scrapeApp(packageId) {
  try {
    const data = await gplay.app({ appId: packageId, lang: 'en', country: 'in', throttle: 10 });
    const titleWords = tokenize(data.title || '');
    const summaryWords = tokenize(data.summary || '');
    const descWords = tokenize(data.description || '');
    return {
      success: true,
      packageId,
      name: data.title || packageId,
      summary: data.summary || '',
      description: data.description || '',
      rating: data.score ? Math.round(data.score * 10) / 10 : null,
      ratingCount: formatCount(data.ratings),
      installs: data.installs || 'Unknown',
      lastUpdated: data.updated ? new Date(data.updated).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'Unknown',
      version: data.currentVersion || '',
      genre: data.genre || '',
      developer: data.developer || '',
      screenshotsCount: data.screenshots ? data.screenshots.length : 0,
      icon: data.icon || '',
      titleLength: (data.title || '').length,
      summaryLength: (data.summary || '').length,
      titleWords,
      summaryWords,
      descWords,
      contentForAI: {
        title: data.title || '',
        summary: data.summary || '',
        description: (data.description || '').slice(0, 1500)
      }
    };
  } catch (err) {
    return { success: false, packageId, error: err.message };
  }
}

function tokenize(text) {
  const stopwords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','is','are','was',
    'were','be','been','have','has','had','do','does','did','will','would','could','should',
    'may','might','can','your','our','their','its','this','that','these','those','it','we',
    'you','he','she','they','all','any','both','each','few','more','most','other','some',
    'such','into','through','during','before','after','above','below','from','up','down',
    'out','off','over','under','again','then','once','also','just','now','very','too','so',
    'if','as','by','get','new','use','using','make','making','made','helps','help','allows',
    'lets','gives','provides','best','free','app','apps','android','phone','mobile','easy',
    'easily','simple','simply','quickly','fast','instantly','today','india','indian'
  ]);
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i).slice(0, 50);
}

function formatCount(n) {
  if (!n) return 'Unknown';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M+';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K+';
  return n.toString();
}

function computeKeywordGaps(apps) {
  const kwMap = {};
  apps.forEach((app, idx) => {
    if (!app.success) return;
    const kws = [...new Set([...app.titleWords, ...app.summaryWords, ...(app.descWords || []).slice(0, 20)])];
    kws.forEach(kw => {
      if (!kwMap[kw]) kwMap[kw] = new Array(apps.length).fill(false);
      kwMap[kw][idx] = true;
    });
  });

  const gaps = Object.entries(kwMap).map(([kw, presence]) => ({
    keyword: kw,
    youHave: presence[0],
    competitors: presence.slice(1),
    competitorCount: presence.slice(1).filter(Boolean).length
  })).filter(g => g.competitorCount > 0 || g.youHave);

  gaps.sort((a, b) => {
    if (!a.youHave && b.youHave) return -1;
    if (a.youHave && !b.youHave) return 1;
    return b.competitorCount - a.competitorCount;
  });

  return gaps.slice(0, 20);
}

function computeMetadataScores(app) {
  if (!app.success) return null;
  const titleLen = app.titleLength;
  const titleScore = titleLen === 0 ? 0 : titleLen <= 30 && titleLen >= 15 ? 100
    : titleLen < 15 ? Math.round((titleLen / 15) * 70)
    : Math.round(Math.max(40, 100 - ((titleLen - 30) * 3)));

  const summaryLen = app.summaryLength;
  const shortDescScore = summaryLen === 0 ? 0 : summaryLen >= 70 ? 100 : Math.round((summaryLen / 80) * 100);

  const descLen = (app.description || '').length;
  const longDescScore = descLen === 0 ? 0 : descLen >= 3000 ? 100 : descLen >= 1500 ? 80 : descLen >= 800 ? 60 : Math.round((descLen / 800) * 60);

  const shots = app.screenshotsCount || 0;
  const visualScore = shots === 0 ? 0 : shots >= 8 ? 100 : Math.round((shots / 8) * 100);

  const overall = Math.round((titleScore * 0.30) + (shortDescScore * 0.25) + (longDescScore * 0.20) + (visualScore * 0.20) + (app.titleWords.length >= 3 ? 5 : 0));
  return {
    titleOptimization: titleScore,
    shortDescOptimization: shortDescScore,
    longDescOptimization: longDescScore,
    visualOptimization: visualScore,
    overallASO: Math.min(100, overall)
  };
}

function buildAnalysisPrompt(apps) {
  const appsData = apps.map((app, i) => {
    const label = i === 0 ? 'YOUR APP' : `COMPETITOR ${i}`;
    if (!app.success) return `${label} (${app.packageId}): FAILED TO FETCH`;
    return `${label}: ${app.name} (${app.packageId})
  Title [${app.titleLength} chars]: "${app.contentForAI.title}"
  Short Description [${app.summaryLength} chars]: "${app.contentForAI.summary}"
  Description excerpt: "${app.contentForAI.description.slice(0, 800)}"
  Rating: ${app.rating} (${app.ratingCount} ratings) | Installs: ${app.installs}
  Screenshots: ${app.screenshotsCount} | Genre: ${app.genre}
  Title keywords: ${app.titleWords.join(', ')}
  Short desc keywords: ${app.summaryWords.join(', ')}`;
  }).join('\n\n');

  return `You are an expert ASO analyst. I have scraped REAL Play Store data. Analyze the actual text.

${appsData}

Based on the REAL metadata above, return this JSON:
{
  "keywordGaps": [
    { "keyword": "real keyword from competitor text", "searchVolume": "High|Medium|Low", "context": "where competitor uses this", "opportunity": "specific recommendation for YOUR APP" }
  ],
  "titleInsights": [
    { "appIndex": 0, "observation": "specific observation about this app title", "recommendation": "concrete improvement" }
  ],
  "shortDescInsights": [
    { "appIndex": 0, "observation": "what this app does well or poorly", "recommendation": "concrete improvement" }
  ],
  "insights": [
    { "type": "gap|win|opportunity", "severity": "high|medium|low", "text": "specific insight referencing actual scraped content" }
  ],
  "experiments": [
    {
      "priority": "High|Medium|Low",
      "element": "App title|Short description|Long description|Screenshots|Icon",
      "title": "Specific experiment name",
      "hypothesis": "If we [specific change based on real data], we expect [result] because [reason]",
      "description": "Detailed description referencing actual competitor strategies seen in the data",
      "expectedLift": "X-Y% CVR improvement",
      "effort": "Low|Medium|High",
      "inspiredBy": "Which competitor this is inspired by"
    }
  ],
  "overallSummary": "2-3 sentences on competitive landscape based on real data"
}

Rules: Reference ACTUAL text. Keyword gaps = real keywords in competitor titles/descs missing from YOUR APP. Return ONLY valid JSON.`;
}

app.post('/api/analyze', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });

  const { urls } = req.body;
  if (!urls || !urls[0]) return res.status(400).json({ error: 'At least one URL is required.' });

  const packageIds = urls.map(extractPackageId).filter(Boolean);
  if (!packageIds[0]) return res.status(400).json({ error: 'Could not extract a valid package ID from the first URL.' });

  try {
    console.log(`Scraping ${packageIds.length} apps:`, packageIds);
    const scrapeResults = await Promise.all(packageIds.map(scrapeApp));
    console.log('Scrape done:', scrapeResults.map(r => ({ pkg: r.packageId, ok: r.success, err: r.error })));

    const appsWithScores = scrapeResults.map(app => ({
      ...app,
      metadataScores: app.success ? computeMetadataScores(app) : null
    }));

    const successfulApps = appsWithScores.filter(a => a.success);
    const keywordGapMatrix = successfulApps.length > 1 ? computeKeywordGaps(successfulApps) : [];

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: 'You are an expert ASO analyst. Always respond with valid JSON only. No markdown, no backticks.',
        messages: [{ role: 'user', content: buildAnalysisPrompt(appsWithScores) }]
      })
    });

    if (!claudeRes.ok) throw new Error(`Claude API error: ${await claudeRes.text()}`);

    const claudeData = await claudeRes.json();
    const raw = claudeData.content.map(b => b.text || '').join('').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/g, '').trim();
    const aiAnalysis = JSON.parse(raw);

    res.json({ success: true, data: { apps: appsWithScores, keywordGapMatrix, aiAnalysis, scrapedAt: new Date().toISOString() } });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`ASO Analyzer v2 running on port ${PORT}`));
