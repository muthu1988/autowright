const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OllamaClient = require('./llmClient');

class DomAnalyzer {
  constructor(options = {}) {
    this.inputFile = options.inputFile || 'raw-dom.json';
    this.outputFile = options.outputFile || 'analysis-output.json';
    this.enableCache = options.enableCache !== false; // Cache enabled by default
    this.cacheDir = options.cacheDir || path.join(process.cwd(), '.cache', 'llm-responses');

    this.client = new OllamaClient({
      model: options.model || 'qwen2.5:7b',
      temperature: 0.1,
      timeout: options.timeout || 300000, // 5 minutes for DOM analysis
    });

    // Ensure cache directory exists
    if (this.enableCache) {
      this.ensureCacheDir();
    }
  }

  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  getCacheKey(methodName, content) {
    // Use simple static keys for development caching
    return `${methodName}_simple.json`;
  }

  getCachedResponse(methodName, content) {
    if (!this.enableCache) return null;
    
    const cacheKey = this.getCacheKey(methodName, content);
    const cachePath = path.join(this.cacheDir, cacheKey);
    
    if (fs.existsSync(cachePath)) {
      // High-level: cache hit log
      console.log(`Using cached response for ${methodName}`);
      try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch (err) {
        // High-level: cache file warning
        console.log(`Invalid cache file, will regenerate: ${cacheKey}`);
        return null;
      }
    }
    return null;
  }

  saveCachedResponse(methodName, content, response) {
    if (!this.enableCache) return;
    
    const cacheKey = this.getCacheKey(methodName, content);
    const cachePath = path.join(this.cacheDir, cacheKey);
    
    try {
      fs.writeFileSync(cachePath, JSON.stringify(response, null, 2));
      // High-level: cache save log
      console.log(`Cached response for ${methodName} (${cacheKey})`);
    } catch (err) {
      // High-level: cache save error
      console.log(`Failed to save cache: ${err.message}`);
    }
  }
  normalizeUrlForCaching(url) {
    try {
      const urlObj = new URL(url);
      // Remove query parameters and hash to normalize dynamic URLs
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch (err) {
      // If URL parsing fails, return the original URL
      return url;
    }
  }
  async analyze() {
    // Look for input file in output directory
    const inputPath = path.join('output', this.inputFile);
    const rawData = JSON.parse(
      fs.readFileSync(inputPath, 'utf-8')
    );

    const page = rawData[0];

    const interactive = page.elements.filter(el =>
      ['button', 'input', 'select', 'textarea', 'a'].includes(el.tag)
    );

    // Normalize metadata for caching (remove dynamic URL parameters)
    const normalizedMetadata = {
      ...page.metadata,
      url: this.normalizeUrlForCaching(page.metadata.url)
    };

    const simplified = {
      metadata: normalizedMetadata,
      interactiveElements: interactive.slice(0, 200),
    };

    // Check cache first
    const cacheContent = { method: 'analyze' };
    const cachedResult = this.getCachedResponse('analyze', cacheContent);
    

    
    if (cachedResult) {
      // Still save to output file for consistency
      const outputDir = 'output';
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const outputPath = path.join(outputDir, this.outputFile);
      fs.writeFileSync(outputPath, JSON.stringify(cachedResult, null, 2));
      // High-level: analysis save log
      console.log(`Analysis saved to ${outputPath} (from cache)`);
      return cachedResult;
    }

    const prompt = `
You are a senior QA automation engineer.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanations.
Do not include backticks.

IMPORTANT: For Playwright selectors, use proper CSS selector syntax:
- For elements with data-testid: use [data-testid='value'] (not [data-testid='value'] element)
- For elements with id: use #id
- For elements with class: use .class
- For specific element types with attributes: use element[attribute='value']
- Examples: 
  * button[data-testid='Submit'] (correct)
  * [data-testid='Submit'] button (wrong - this looks for button inside testid element)

{
  "pageType": "...",
  "recommendedLocators": [
    {
      "description": "...",
      "playwrightLocator": "...",
      "reason": "..."
    }
  ],
  "testScenarios": [
    {
      "name": "...",
      "steps": ["...", "..."]
    }
  ]
}

PAGE DATA:
${JSON.stringify(simplified, null, 2)}
`;

    // High-level: LLM request log
    console.log('Generating fresh LLM response for analyze...');
    const result = await this.client.generate(prompt);

    // 🔥 Extract JSON safely
    const jsonMatch = result.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      fs.writeFileSync('raw-llm-output.txt', result);
      throw new Error('No valid JSON found in LLM response');
    }

    let parsed;

    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      fs.writeFileSync('raw-llm-output.txt', result);
      throw new Error('LLM returned malformed JSON');
    }

    // ✅ Inject URL from crawler metadata (guaranteed correct - use original URL)
    parsed.url = page.metadata.url;

    // Cache the response
    this.saveCachedResponse('analyze', cacheContent, parsed);

    // ✅ Ensure output directory exists
    const outputDir = 'output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // ✅ Save clean formatted JSON only
    const outputPath = path.join(outputDir, this.outputFile);
    fs.writeFileSync(
      outputPath,
      JSON.stringify(parsed, null, 2)
    );

    // High-level: analysis save log
    console.log(`Analysis saved to ${outputPath}`);

    return parsed;
  }

  async extractAuthSelectors(existingAnalysis = null) {
    const analysis = existingAnalysis || await this.analyze();

    if (!analysis.pageType.toLowerCase().includes('login')) {
      throw new Error('Page is not identified as a login page');
    }

    // Check cache first
    const cacheContent = { method: 'extractAuthSelectors' };
    const cachedResult = this.getCachedResponse('extractAuthSelectors', cacheContent);
    
    if (cachedResult) {
      // Still update the output file
      const outputDir = 'output';
      const outputPath = path.join(outputDir, this.outputFile);
      const updatedAnalysis = { ...analysis, authSelectors: cachedResult };
      fs.writeFileSync(outputPath, JSON.stringify(updatedAnalysis, null, 2));
      // High-level: auth selectors cache log
      console.log(`Auth selectors saved to ${outputPath} (from cache)`);
      return cachedResult;
    }

    const prompt = `You are a senior QA automation engineer.

    Based on the following page analysis, extract the most reliable Playwright selectors for username/email input, password input, and submit button.

    IMPORTANT: Use proper Playwright CSS selector syntax:
    - For elements with data-testid: use [data-testid='value'] OR element[data-testid='value']
    - For elements with id: use #id
    - Examples:
      * button[data-testid='Submit'] (correct)
      * [data-testid='Submit'] (correct if unique)
      * [data-testid='Submit'] button (wrong - looks for button inside testid element)

    Return ONLY valid JSON in the following format:
    {
      "usernameSelector": "...",
      "passwordSelector": "...",
      "submitSelector": "..."

    }
    PAGE ANALYSIS:
    ${JSON.stringify(analysis, null, 2)}
    `;

    console.log('🤖 Generating fresh LLM response for extractAuthSelectors...');
    const result = await this.client.generate(prompt);

    const jsonMatch = result.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      fs.writeFileSync('raw-llm-output.txt', result);
      throw new Error('No valid JSON found in LLM response');
    }

    let selectors;

    try {
      selectors = JSON.parse(jsonMatch[0]);
    } catch (err) {
      fs.writeFileSync('raw-llm-output.txt', result);
      throw new Error('LLM returned malformed JSON');
    }

    // Cache the response
    // Cache the response
    this.saveCachedResponse('extractAuthSelectors', cacheContent, selectors);

    // ✅ Save selectors to analysis output file
    const outputDir = 'output';
    const outputPath = path.join(outputDir, this.outputFile);
    
    // Read existing analysis and add selectors
    const updatedAnalysis = { ...analysis, authSelectors: selectors };
    
    fs.writeFileSync(
      outputPath,
      JSON.stringify(updatedAnalysis, null, 2)
    );
    
    console.log(`Auth selectors saved to ${outputPath}`);

    return selectors;
  }
}

module.exports = DomAnalyzer;