const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LLMClient = require('./llmClient');

class RouteAnalyzer {
  constructor(options = {}) {
    this.inputFile = options.inputFile || 'routes.json';
    this.outputFile = options.outputFile || 'route-analysis.json';
    this.model = options.model || 'qwen2.5:7b';
    this.temperature = options.temperature || 0.1;
    this.timeout = options.timeout || 600000; // 10 minutes for route analysis
    this.enableCache = options.enableCache !== false; // Cache enabled by default
    this.cacheDir = options.cacheDir || path.join(process.cwd(), '.cache', 'llm-responses');

    this.llmClient = new LLMClient({
      baseUrl: 'http://localhost:11434',
      model: this.model,
      temperature: this.temperature,
      timeout: this.timeout,
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
      console.log(`Cached response for ${methodName}`);
    } catch (err) {
      // High-level: cache save error
      console.warn(`Failed to cache response: ${err.message}`);
    }
  }

  /**
   * Load routes data from output folder
   */
  loadRoutesData() {
    try {
      const routesPath = path.join('output', this.inputFile);
      if (!fs.existsSync(routesPath)) {
        throw new Error('Routes file not found. Please run route exploration first.');
      }

      const routesData = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      // High-level: loaded routes log
      console.log('Loaded discovered routes for analysis');
      return routesData;
    } catch (error) {
      throw new Error(`Failed to load routes data: ${error.message}`);
    }
  }

  /**
   * Analyze routes using LLM for categorization and risk assessment
   */
  async analyzeRoutes() {
    const routesData = this.loadRoutesData();

    if (!routesData.discoveredRoutes || routesData.discoveredRoutes.length === 0) {
      // High-level: no routes warning
      console.log('No routes found for analysis');
      return {
        totalRoutes: 0,
        categories: [],
        riskSummary: { high: 0, medium: 0, low: 0 },
        timestamp: new Date().toISOString()
      };
    }

    // High-level: analysis start log
    console.log(`Analyzing ${routesData.discoveredRoutes.length} discovered routes...`);

    if (routesData.navigationStructure && routesData.navigationStructure.length > 0) {
      // High-level: using navigation structure log
      console.log(`Using ${routesData.navigationStructure.length} pre-extracted navigation menus from RouteExplorer`);
    } else {
      // High-level: no navigation structure warning
      console.log('No navigation structure found - will analyze routes individually');
    }

    const analysisPrompt = this.buildAnalysisPrompt(routesData);

    // Check cache first
    const cacheContent = { method: 'analyzeRoutes' };
    const cachedResult = this.getCachedResponse('analyzeRoutes', cacheContent);

    if (cachedResult) {
      // High-level: cache hit log
      console.log('Using cached route analysis');
      // Still save to output file for consistency
      this.saveAnalysis(cachedResult);
      return cachedResult;
    }

    // High-level: LLM connection log
    console.log('Connecting to Ollama LLM service...');

    try {
      // High-level: LLM request log
      console.log('Generating fresh LLM response for analyzeRoutes...');
      const llmResponse = await this.llmClient.generate(analysisPrompt);

      // Debug: Save raw LLM response for troubleshooting
      if (process.env.DEBUG_LLM) {
        fs.writeFileSync('raw-llm-response.txt', llmResponse);
        // High-level: raw LLM response log
        console.log('Raw LLM response saved to raw-llm-response.txt');
      }

      const analysisResult = this.parseAnalysisResponse(llmResponse);

      // Enhance with metadata
      const enhancedResult = {
        ...analysisResult,
        totalRoutes: routesData.discoveredRoutes.length,
        failedRoutes: routesData.failedRoutes?.length || 0,
        explorationDomain: routesData.explorationDomain,
        analysisTimestamp: new Date().toISOString(),
        analysisType: 'dom-extracted-navigation',
        navigationExtractionSource: 'RouteExplorer DOM analysis',
        originalRoutesData: {
          successful: routesData.discoveredRoutes,
          failed: routesData.failedRoutes || [],
          skipped: routesData.skippedLogoutRoutes || [],
          extractedNavigation: routesData.navigationStructure || []
        }
      };

      // Cache the enhanced result
      this.saveCachedResponse('analyzeRoutes', cacheContent, enhancedResult);

      // Save analysis results
      this.saveAnalysis(enhancedResult);

      return enhancedResult;

    } catch (error) {
      // Enhanced error messages for common issues
      if (error.message.includes('fetch')) {
        throw new Error(`Failed to connect to Ollama service at http://localhost:11434. Please ensure Ollama is running with: ollama serve`);
      }
      if (error.message.includes('model')) {
        throw new Error(`Model '${this.model}' not found. Please install it with: ollama pull ${this.model}`);
      }
      throw new Error(`Route analysis failed: ${error.message}`);
    }
  }

  /**
   * Pre-analyze routes to identify navigation hierarchy patterns
   */
  analyzeRouteHierarchy(routes) {
    const hierarchy = {
      topLevel: [],
      nested: {},
      patterns: []
    };

    // Group routes by depth and parent paths
    routes.forEach(route => {
      const parts = route.split('/').filter(Boolean);
      const depth = parts.length;

      if (depth === 1) {
        hierarchy.topLevel.push(route);
      } else if (depth > 1) {
        const parent = '/' + parts[0];
        if (!hierarchy.nested[parent]) {
          hierarchy.nested[parent] = [];
        }
        hierarchy.nested[parent].push(route);
      }
    });

    // Identify common patterns
    const commonPatterns = ['admin', 'dashboard', 'profile', 'settings', 'user', 'account', 'reports', 'analytics'];
    hierarchy.patterns = routes.filter(route =>
      commonPatterns.some(pattern => route.toLowerCase().includes(pattern))
    );

    return `
NAVIGATION HIERARCHY PATTERNS DETECTED:
- Top-level routes (${hierarchy.topLevel.length}): ${hierarchy.topLevel.join(', ')}
- Nested route groups: ${Object.keys(hierarchy.nested).map(parent =>
      `${parent} (${hierarchy.nested[parent].length} sub-routes)`).join(', ')}
- Common navigation patterns found: ${hierarchy.patterns.join(', ')}

DETAILED GROUPINGS:
${Object.entries(hierarchy.nested).map(([parent, children]) =>
        `${parent}:\n  ${children.join('\n  ')}`).join('\n\n')}
    `.trim();
  }

  /**
   * Build analysis prompt using pre-organized navigation structure from RouteExplorer
   */
  buildAnalysisPrompt(routesData) {
    const routes = routesData.discoveredRoutes;
    const domain = routesData.explorationDomain || routesData.baseUrl;
    const navigationStructure = routesData.navigationStructure || [];

    // Drastically optimize: Deduplicate and group navigation entries
    const routeToMenus = new Map();
    
    // Group menus by their primary route (many menus point to same route)
    navigationStructure.forEach(menu => {
      if (menu.routes && menu.routes.length > 0) {
        const primaryRoute = menu.routes[0];
        if (!routeToMenus.has(primaryRoute)) {
          routeToMenus.set(primaryRoute, []);
        }
        routeToMenus.get(primaryRoute).push(menu.menuName);
      }
    });

    // Create super-compact summary - just unique routes with their menu context
    const compactNavigation = Array.from(routeToMenus.entries())
      .slice(0, 10) // Limit to 10 most important route groups
      .map(([route, menus]) => ({
        route,
        menuNames: menus.slice(0, 2), // Max 2 menu names per route
        menuCount: menus.length
      }));

    const prompt = `Analyze ${routes.length} web application routes for security risks.

**DOMAIN**: ${domain}

**KEY ROUTES** (${routes.length} total):
${routes.slice(0, 15).map((route, i) => `${i + 1}. ${route}`).join('\n')}${routes.length > 15 ? `\n... and ${routes.length - 15} more` : ''}

**NAVIGATION GROUPS** (${compactNavigation.length} groups):
${compactNavigation.map(nav => 
  `• ${nav.route} (${nav.menuCount} menu${nav.menuCount > 1 ? 's' : ''}: ${nav.menuNames.join(', ')}${nav.menuCount > 2 ? ` +${nav.menuCount - 2} more` : ''})`
).join('\n')}

Return JSON with security analysis - assign risk levels based on route functionality:

{
  "navigationStructure": [
    {
      "menuName": "Payment Systems",
      "routes": ["/mortgage/servicing/make-a-payment", "/mortgage/servicing/manage-autopay"],
      "riskLevel": "High",
      "businessCriticality": "Critical"
    }
  ],
  "riskSummary": { "high": 0, "medium": 0, "low": 0 },
  "totalRoutes": ${routes.length}
}`;

    return prompt;
  }


  /**
   * Parse and validate LLM response for navigation-based analysis
   */
  parseAnalysisResponse(response) {
    try {
      // Extract JSON from response (handle potential markdown formatting)
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) ||
        response.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        // High-level: no JSON found warning
        console.log('No JSON found in LLM response. Raw response:');
        console.log(response.substring(0, 500) + '...');
        throw new Error('No valid JSON found in LLM response');
      }

      const analysisResult = JSON.parse(jsonMatch[1]);

      // Validate required navigation structure
      if (!analysisResult.navigationStructure || !Array.isArray(analysisResult.navigationStructure)) {
        // High-level: invalid analysis format warning
        console.log('Invalid analysis format: missing navigationStructure array');
        throw new Error('Invalid analysis format: missing navigationStructure array');
      }

      // Initialize summaries if missing
      if (!analysisResult.riskSummary) {
        analysisResult.riskSummary = { high: 0, medium: 0, low: 0 };
      }

      if (!analysisResult.menuSummary) {
        analysisResult.menuSummary = {
          totalMenus: 0,
          mainMenus: 0,
          subMenus: 0,
          standalonePages: 0
        };
      }

      // Calculate risk and menu summaries
      const riskCounts = { high: 0, medium: 0, low: 0 };
      const menuCounts = {
        totalMenus: analysisResult.navigationStructure.length,
        mainMenus: 0,
        subMenus: 0,
        standalonePages: 0
      };

      analysisResult.navigationStructure.forEach(menu => {
        // Count risk levels based on routes in each menu
        const risk = (menu.riskLevel || 'low').toLowerCase();
        if (riskCounts.hasOwnProperty(risk)) {
          riskCounts[risk] += menu.routes?.length || 0;
        }

        // Count menu types
        const menuType = (menu.menuType || 'standalone').toLowerCase();
        if (menuType === 'main') {
          menuCounts.mainMenus++;
        } else if (menuType === 'sub') {
          menuCounts.subMenus++;
        } else {
          menuCounts.standalonePages++;
        }

        // Add sub-menu routes to counts
        if (menu.subMenus && Array.isArray(menu.subMenus)) {
          menu.subMenus.forEach(subMenu => {
            menuCounts.subMenus++;
            const subRisk = (menu.riskLevel || 'low').toLowerCase();
            if (riskCounts.hasOwnProperty(subRisk)) {
              riskCounts[subRisk] += subMenu.routes?.length || 0;
            }
          });
        }
      });

      analysisResult.riskSummary = riskCounts;
      analysisResult.menuSummary = menuCounts;

      // Ensure priorityTargets and recommendations exist
      if (!analysisResult.priorityTargets) {
        analysisResult.priorityTargets = [];
      }
      if (!analysisResult.recommendations) {
        analysisResult.recommendations = [];
      }

      // High-level: successful parse log
      console.log('Successfully parsed navigation-based LLM analysis response');
      console.log(`Found ${menuCounts.totalMenus} navigation menus with ${menuCounts.mainMenus} main sections`);

      return analysisResult;

    } catch (error) {
      // High-level: parse error log
      console.log('Parse error details:', error.message);
      throw new Error(`Failed to parse analysis response: ${error.message}`);
    }
  }

  /**
   * Save analysis results to output folder
   */
  saveAnalysis(analysisResult) {
    try {
      // Ensure output directory exists
      const outputDir = 'output';
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputPath = path.join(outputDir, this.outputFile);
      fs.writeFileSync(outputPath, JSON.stringify(analysisResult, null, 2));

      // High-level: analysis save log
      console.log(`Route analysis saved to ${outputPath}`);
    } catch (error) {
      throw new Error(`Failed to save analysis: ${error.message}`);
    }
  }
}

module.exports = RouteAnalyzer;