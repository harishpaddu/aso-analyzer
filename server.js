require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ASO Analysis endpoint — proxies to Anthropic, keeps key server-side
app.post('/api/analyze', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured. Set it in Railway environment variables.'
    });
  }

  const { urls, packageIds } = req.body;

  if (!urls || !urls[0]) {
    return res.status(400).json({ error: 'At least one URL is required.' });
  }

  const prompt = buildPrompt(urls, packageIds);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are an expert ASO (App Store Optimization) analyst specializing in Google Play Store.
You analyze Play Store apps and provide detailed competitive intelligence.
Use your training knowledge about apps to provide accurate analysis. For well-known apps, use real data.
For unknown apps, make reasonable inferences from the package ID and category.
ALWAYS respond with valid JSON only. No markdown, no backticks, no preamble. Return ONLY the raw JSON object.`,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${err}` });
    }

    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    let clean = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/g, '').trim();

    const parsed = JSON.parse(clean);
    res.json({ success: true, data: parsed });

  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ASO Analyzer running on port ${PORT}`);
});

function buildPrompt(urls, packageIds) {
  const myApp = urls[0];
  const competitors = urls.slice(1).filter(Boolean);

  return `Analyze these Play Store apps for ASO competitive intelligence:

MY APP: ${myApp}
Package: ${packageIds[0]}

COMPETITORS:
${competitors.map((u, i) => `${i + 1}. ${u} (package: ${packageIds[i + 1] || 'unknown'})`).join('\n')}

Provide a comprehensive ASO analysis as JSON with EXACTLY this structure:
{
  "apps": [
    {
      "label": "YOU",
      "name": "App name",
      "packageId": "com.example",
      "category": "Category",
      "rating": 4.2,
      "ratingCount": "50K+",
      "installs": "1M+",
      "lastUpdated": "Mar 2025",
      "titleLength": 28,
      "titleKeywords": ["keyword1","keyword2"],
      "shortDescKeywords": ["kw1","kw2","kw3"],
      "keyFeatures": ["feature1","feature2","feature3"],
      "metadataScores": {
        "titleOptimization": 72,
        "shortDescOptimization": 65,
        "longDescOptimization": 58,
        "screenshotCount": 7,
        "visualOptimization": 60,
        "overallASO": 64
      }
    }
  ],
  "keywordGaps": [
    {
      "keyword": "keyword phrase",
      "searchVolume": "High",
      "youHave": true,
      "competitors": [true, false, true, false],
      "opportunity": "Why this matters for your app"
    }
  ],
  "titleComparison": [
    {
      "appLabel": "YOU",
      "title": "Full app title here",
      "shortDesc": "Short description text",
      "titleScore": 72,
      "observations": "What they do well or miss"
    }
  ],
  "insights": [
    { "type": "gap", "severity": "high", "text": "Insight text" },
    { "type": "win", "severity": "medium", "text": "Insight text" },
    { "type": "opportunity", "severity": "high", "text": "Insight text" }
  ],
  "experiments": [
    {
      "priority": "High",
      "element": "App title",
      "title": "Experiment title",
      "hypothesis": "If we [change], we expect [result] because [reason]",
      "description": "Detailed description of what to test and how",
      "expectedLift": "15-25%",
      "effort": "Low"
    }
  ]
}

Return 8-12 keyword gaps, 5-7 insights, 6-8 experiment recommendations.
Include ALL competitor apps in the apps array (first is always the user's app).
competitors array in keywordGaps should have one boolean per competitor app.
Be specific, data-driven, and actionable. Return ONLY the JSON object.`;
}
