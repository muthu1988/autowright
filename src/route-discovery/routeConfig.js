'use strict';
const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', '..', 'config', 'routes.config.json');

/** Normalise to pathname only — matches the test folder key */
function toPathKey(url) {
  try   { return new URL(url, 'https://x').pathname; }
  catch { return url.split('?')[0]; }
}

/**
 * Sync newly discovered routes into routes.config.json.
 * New routes are added as "excluded". Existing entries are never overwritten.
 */
function sync(routeAnalysis) {
  const existing = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    : [];

  const existingKeys = new Set(existing.map(e => toPathKey(e.url)));

  // Build a risk map from navigationStructure
  const riskMap = {};
  for (const menu of routeAnalysis.navigationStructure || []) {
    for (const r of menu.routes || []) {
      const key = toPathKey(r);
      if (!riskMap[key]) {
        riskMap[key] = {
          riskLevel: menu.riskLevel || 'Unknown',
          businessCriticality: menu.businessCriticality || 'Unknown',
        };
      }
    }
  }

  // Collect query-param-inclusive URLs from extractedNavigation (first-seen wins)
  const paramMap = {};
  for (const menu of routeAnalysis.originalRoutesData?.extractedNavigation || []) {
    for (const r of menu.routes || []) {
      const key = toPathKey(r);
      if (!paramMap[key]) paramMap[key] = r;
    }
  }

  // Collect all candidate routes: crawled routes + navigation-only routes
  const allCandidates = [...(routeAnalysis.originalRoutesData?.successful || [])];

  // Add routes from navigationStructure that the crawler never visited
  for (const [key, navUrl] of Object.entries(paramMap)) {
    if (!allCandidates.some(r => toPathKey(r) === key)) {
      allCandidates.push(navUrl);
    }
  }

  let added = 0;
  for (const r of allCandidates) {
    const key = toPathKey(r);
    if (existingKeys.has(key)) continue;

    const url       = paramMap[key] || r;
    const nameParts = key.replace(/^\//, '').split('/');
    const name      = nameParts[nameParts.length - 1]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    existing.push({
      url,
      name,
      ...(riskMap[key] || { riskLevel: 'Unknown', businessCriticality: 'Unknown' }),
      status: 'excluded',
    });
    existingKeys.add(key);
    added++;
  }

  // Ensure the config directory exists before writing
  const configDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2));
  console.log(`[routeConfig] Synced ${added} new route(s) into routes.config.json. Total: ${existing.length}`);
  return existing;
}

/**
 * Return absolute URLs for all entries with status "included".
 * baseUrl is used to resolve relative paths.
 */
function getIncluded(baseUrl) {
  if (!fs.existsSync(CONFIG_FILE)) return [];

  const entries = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const included = entries
    .filter(e => e.status === 'included')
    .map(e => {
      try   { new URL(e.url); return e.url; }          // already absolute
      catch { return new URL(e.url, baseUrl).href; }   // resolve relative
    });

  console.log(`[routeConfig] ${included.length} route(s) included for processing`);
  return included;
}

module.exports = { sync, getIncluded };
