const fetch = require('node-fetch');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none'
};

function extractPackageId(url) {
  try {
    const m = url.match(/id=([a-zA-Z0-9._]+)/);
    return m ? m[1] : url.trim();
  } catch (e) {
    return url.trim();
  }
}

function buildPlayStoreUrl(packageId) {
  return `https://play.google.com/store/apps/details?id=${packageId}&hl=en&gl=US`;
}

// Extract data from AF_initDataCallback blobs — Play Store's main data mechanism
function extractFromDataBlobs(html) {
  const result = {};

  // Try to get rating from structured data / meta tags first (most reliable)
  const $ = cheerio.load(html);

  // Title — multiple fallbacks
  result.title =
    $('h1[itemprop="name"] span').first().text().trim() ||
    $('h1.Fd93Bb span').first().text().trim() ||
    $('[data-g-id="description"]').prev('h1').text().trim() ||
    '';

  // Short description
  result.shortDescription =
    $('[data-g-id="description"]').prev('[jsname]').text().trim() ||
    $('div[jsname="sngebd"]').text().trim() ||
    '';

  // Long description
  result.longDescription =
    $('[data-g-id="description"]').text().trim() ||
    $('div[jsname="bN97Pc"]').text().trim() ||
    '';

  // Rating
  const ratingEl = $('[itemprop="starRating"] [aria-label]').attr('aria-label') ||
    $('[itemprop="ratingValue"]').attr('content') || '';
  const ratingMatch = ratingEl.match(/(\d+\.?\d*)/);
  result.rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  // Rating count
  const ratingCountEl = $('[itemprop="ratingCount"]').attr('content') ||
    $('[aria-label*="ratings"]').attr('aria-label') || '';
  const countMatch = ratingCountEl.match(/([\d,]+)/);
  result.ratingCount = countMatch ? countMatch[1].replace(/,/g, '') : null;

  // Installs — look for the "10M+" style text
  $('div').each((_, el) => {
    const text = $(el).text().trim();
    if (/^[\d,.]+[KMB]?\+$/.test(text) && text.length < 15) {
      result.installs = result.installs || text;
    }
  });

  // Category
  $('a[itemprop="genre"]').each((_, el) => {
    result.category = result.category || $(el).text().trim();
  });

  // Last updated & other metadata — look in the info section
  $('div').each((_, el) => {
    const text = $(el).text().trim();
    const children = $(el).children().length;
    if (children === 0 && /^[A-Z][a-z]+ \d+, \d{4}$/.test(text)) {
      result.lastUpdated = result.lastUpdated || text;
    }
  });

  // Developer name
  result.developer =
    $('[itemprop="author"] [itemprop="name"]').text().trim() ||
    $('a[href*="/store/apps/developer"]').first().text().trim() ||
    '';

  // Screenshots count
  result.screenshotCount = $('img[src*="play-lh.googleusercontent.com"]').length || 0;

  // Now try to extract from the JS data blobs for more reliable data
  extractFromJSBlobs(html, result);

  return result;
}

function extractFromJSBlobs(html, result) {
  // Play Store embeds data in AF_initDataCallback and similar patterns
  // Extract rating more reliably from JSON blobs
  try {
    // Rating pattern in JSON: typically [4.3] or similar
    const ratingBlob = html.match(/"ratingValue":\s*"?([\d.]+)"?/);
    if (ratingBlob && !result.rating) {
      result.rating = parseFloat(ratingBlob[1]);
    }

    // Install range pattern
    const installMatch = html.match(/"([\d,]+)\+"/) ||
      html.match(/(\d+(?:,\d+)*)\s*\+\s*downloads/i);
    if (installMatch && !result.installs) {
      result.installs = installMatch[1].replace(/,/g, '') + '+';
    }

    // Look for "Updated" date pattern
    const updatedMatch = html.match(/Updated\s*<\/div>\s*<div[^>]*>([^<]+)<\/div>/i) ||
      html.match(/"datePublished":\s*"([^"]+)"/);
    if (updatedMatch && !result.lastUpdated) {
      result.lastUpdated = updatedMatch[1].trim();
    }

    // Rating count from JSON
    const ratingCountJson = html.match(/"ratingCount":\s*"?(\d+)"?/);
    if (ratingCountJson && !result.ratingCount) {
      result.ratingCount = ratingCountJson[1];
    }

    // Title from JSON/meta
    const titleMeta = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    if (titleMeta && !result.title) {
      result.title = titleMeta[1].replace(' - Apps on Google Play', '').trim();
    }

    // Short desc from meta description
    const descMeta = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    if (descMeta && !result.shortDescription) {
      result.shortDescription = descMeta[1].trim();
    }

  } catch (e) {
    // Ignore extraction errors, use what we have
  }
}

function formatInstalls(rawInstalls) {
  if (!rawInstalls) return 'Unknown';
  const n = parseInt(rawInstalls.replace(/[^0-9]/g, ''));
  if (!n) return rawInstalls;
  if (n >= 1000000000) return Math.floor(n / 1000000000) + 'B+';
  if (n >= 1000000) return Math.floor(n / 1000000) + 'M+';
  if (n >= 1000) return Math.floor(n / 1000) + 'K+';
  return n + '+';
}

function formatRatingCount(raw) {
  if (!raw) return 'Unknown';
  const n = parseInt(raw.replace(/[^0-9]/g, ''));
  if (!n) return raw;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.floor(n / 1000) + 'K';
  return n.toString();
}

// Compute ASO scores from real metadata
function computeASOScores(meta) {
  const title = meta.title || '';
  const shortDesc = meta.shortDescription || '';
  const longDesc = meta.longDescription || '';
  const screenshots = meta.screenshotCount || 0;

  // Title score: ideal 50-80 chars, has keywords, not truncated
  const titleLen = title.length;
  let titleScore = 0;
  if (titleLen >= 20 && titleLen <= 80) titleScore += 40;
  else if (titleLen > 0) titleScore += 20;
  if (title.includes('-') || title.includes(':') || title.includes('|')) titleScore += 20; // has subtitle/keyword separator
  const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  titleScore += Math.min(titleWords.length * 5, 40);
  titleScore = Math.min(titleScore, 100);

  // Short desc score: ideal 80 chars, keyword-rich
  const shortLen = shortDesc.length;
  let shortScore = 0;
  if (shortLen >= 60 && shortLen <= 80) shortScore += 50;
  else if (shortLen >= 30) shortScore += 30;
  else if (shortLen > 0) shortScore += 10;
  const shortWords = shortDesc.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  shortScore += Math.min(shortWords.length * 3, 50);
  shortScore = Math.min(shortScore, 100);

  // Long desc score: ideal 3000-4000 chars, structured
  const longLen = longDesc.length;
  let longScore = 0;
  if (longLen >= 3000) longScore += 40;
  else if (longLen >= 1000) longScore += 30;
  else if (longLen >= 500) longScore += 20;
  else if (longLen > 0) longScore += 10;
  if (longDesc.includes('\n')) longScore += 15; // has structure
  if (longDesc.match(/[•\-\*]/)) longScore += 15; // has bullet points
  const longWords = longDesc.toLowerCase().split(/\s+/).length;
  longScore += Math.min(Math.floor(longWords / 100) * 5, 30);
  longScore = Math.min(longScore, 100);

  // Visual score based on screenshot count
  let visualScore = 0;
  if (screenshots >= 8) visualScore = 100;
  else if (screenshots >= 6) visualScore = 85;
  else if (screenshots >= 4) visualScore = 65;
  else if (screenshots >= 2) visualScore = 40;
  else if (screenshots >= 1) visualScore = 20;

  const overall = Math.round((titleScore * 0.3) + (shortScore * 0.2) + (longScore * 0.3) + (visualScore * 0.2));

  return {
    titleOptimization: Math.round(titleScore),
    shortDescOptimization: Math.round(shortScore),
    longDescOptimization: Math.round(longScore),
    screenshotCount: screenshots,
    visualOptimization: Math.round(visualScore),
    overallASO: overall
  };
}

// Extract keywords from text
function extractKeywords(text) {
  if (!text) return [];
  const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for',
    'of','with','by','from','up','about','into','through','is','are','was','were',
    'be','been','being','have','has','had','do','does','did','will','would','could',
    'should','may','might','shall','can','need','your','our','their','its','this',
    'that','these','those','it','he','she','we','you','they','all','any','both',
    'each','few','more','most','other','some','such','no','not','only','own',
    'same','so','than','too','very','just','app','get','use','make']);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  // Count frequency
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

  // Return top keywords sorted by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);
}

async function scrapePlayStore(url) {
  const packageId = extractPackageId(url);
  const storeUrl = buildPlayStoreUrl(packageId);

  try {
    const response = await fetch(storeUrl, {
      headers: HEADERS,
      timeout: 15000,
      follow: 5
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${packageId}`);
    }

    const html = await response.text();

    if (html.length < 5000) {
      throw new Error(`Response too short for ${packageId} — possibly blocked`);
    }

    const raw = extractFromDataBlobs(html);
    const metadataScores = computeASOScores(raw);
    const allText = `${raw.title} ${raw.shortDescription} ${raw.longDescription}`;
    const keywords = extractKeywords(allText);
    const titleKeywords = extractKeywords(raw.title);
    const shortDescKeywords = extractKeywords(raw.shortDescription);

    return {
      packageId,
      url: storeUrl,
      scraped: true,
      name: raw.title || packageId,
      category: raw.category || 'Unknown',
      developer: raw.developer || 'Unknown',
      rating: raw.rating ? parseFloat(raw.rating.toFixed(1)) : null,
      ratingCount: formatRatingCount(raw.ratingCount),
      installs: formatInstalls(raw.installs) || 'Unknown',
      lastUpdated: raw.lastUpdated || 'Unknown',
      title: raw.title || '',
      shortDescription: raw.shortDescription || '',
      longDescription: raw.longDescription || '',
      screenshotCount: raw.screenshotCount || 0,
      titleKeywords,
      shortDescKeywords,
      allKeywords: keywords,
      metadataScores,
      rawTextLength: {
        title: raw.title.length,
        shortDesc: raw.shortDescription.length,
        longDesc: raw.longDescription.length
      }
    };

  } catch (err) {
    // Return a stub so the analysis can still proceed with a note
    console.error(`Scrape failed for ${packageId}:`, err.message);
    return {
      packageId,
      url: storeUrl,
      scraped: false,
      scrapeError: err.message,
      name: packageId,
      category: 'Unknown',
      developer: 'Unknown',
      rating: null,
      ratingCount: 'Unknown',
      installs: 'Unknown',
      lastUpdated: 'Unknown',
      title: '',
      shortDescription: '',
      longDescription: '',
      screenshotCount: 0,
      titleKeywords: [],
      shortDescKeywords: [],
      allKeywords: [],
      metadataScores: { titleOptimization: 0, shortDescOptimization: 0, longDescOptimization: 0, screenshotCount: 0, visualOptimization: 0, overallASO: 0 },
      rawTextLength: { title: 0, shortDesc: 0, longDesc: 0 }
    };
  }
}

async function scrapeAll(urls) {
  // Scrape all in parallel with a small concurrency limit
  const results = await Promise.all(
    urls.filter(Boolean).map(url => scrapePlayStore(url))
  );
  return results;
}

module.exports = { scrapeAll, scrapePlayStore, extractKeywords, computeASOScores };
