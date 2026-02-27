const fs = require('fs');
const path = require('path');

/**
 * Generate crawl data for routes based on configurable criteria
 * @param {Object} routeAnalysis - The route analysis data
 * @param {Object} options - Configuration options
 * @param {Array} options.businessCriticalityFilter - Array of criticality levels to include (e.g., ['High', 'Medium'])
 * @param {Array} options.testingPriorityFilter - Array of testing priorities to include (e.g., ['High', 'Medium'])
 * @param {number} options.maxRoutes - Maximum number of routes to process (default: 3)
 * @param {string} options.outputDir - Output directory name (default: 'tests')
 * @param {string} options.routesFile - Path to routes file (default: 'output/routes.json')
 * @param {Object} options.sortOrder - Priority order for sorting (default: { 'High': 3, 'Medium': 2, 'Low': 1 })
 */
async function generateCrawlData(routeAnalysis, options = {}) {
  // Set default options
  const config = {
    businessCriticalityFilter: ['High'],
    testingPriorityFilter: ['High', 'Medium', 'Low'],
    maxRoutes: 3,
    outputDir: 'tests',
    routesFile: path.join('output', 'routes.json'),
    sortOrder: { 'High': 3, 'Medium': 2, 'Low': 1 },
    ...options
  };

  // Read routes data to get the correct explorationDomain 
  if (!fs.existsSync(config.routesFile)) {
    throw new Error(`Routes file not found: ${config.routesFile}`);
  }
  const routesData = JSON.parse(fs.readFileSync(config.routesFile, 'utf8'));
  // Prepare set of skipped logout routes (full URLs)
  const skippedLogoutRoutes = new Set((routesData.skippedLogoutRoutes || []).map(url => url.toLowerCase()));
  
  // Filter routes based on configurable criteria
  let filteredRoutes = routeAnalysis.navigationStructure
    ?.filter(route => {
      const businessCriticalityMatch = config.businessCriticalityFilter.includes(route.businessCriticality);
      const testingPriorityMatch = config.testingPriorityFilter.includes(route.testingPriority);
      return businessCriticalityMatch && testingPriorityMatch;
    })
    ?.sort((a, b) => {
      // Sort by testing priority using configurable order
      return (config.sortOrder[b.testingPriority] || 0) - (config.sortOrder[a.testingPriority] || 0);
    }) || [];

  // Also include routes from extractedNavigation that might be missing from main navigationStructure
  const additionalRoutes = routeAnalysis.originalRoutesData?.extractedNavigation
    ?.filter(navItem => navItem.isNavigationMenu && navItem.routes?.length > 0)
    ?.map(navItem => ({
      menuName: navItem.menuName,
      menuType: navItem.menuType,
      routes: navItem.routes,
      subMenus: navItem.subMenus || [],
      riskLevel: "Low", // Default values for extracted routes
      businessCriticality: "Medium", // Default to Medium so they get included
      securityConcerns: ["Access Control", "Data Exposure"],
      testingPriority: "Medium",
      description: `Extracted navigation route: ${navItem.menuName}`
    }))
    ?.filter(route => {
      // Apply same filters to additional routes
      const businessCriticalityMatch = config.businessCriticalityFilter.includes(route.businessCriticality);
      const testingPriorityMatch = config.testingPriorityFilter.includes(route.testingPriority);
      return businessCriticalityMatch && testingPriorityMatch;
    }) || [];

  // Combine and deduplicate routes based on actual route URLs
  const allRoutes = [...filteredRoutes];
  const existingRouteUrls = new Set();
  
  // Track existing routes
  filteredRoutes.forEach(route => {
    route.routes.forEach(url => existingRouteUrls.add(url));
  });
  
  // Add additional routes that aren't already included
  additionalRoutes.forEach(additionalRoute => {
    const hasNewRoutes = additionalRoute.routes.some(url => !existingRouteUrls.has(url));
    if (hasNewRoutes) {
      // Only include routes that are actually new
      const newRoutes = additionalRoute.routes.filter(url => !existingRouteUrls.has(url));
      if (newRoutes.length > 0) {
        allRoutes.push({...additionalRoute, routes: newRoutes});
        newRoutes.forEach(url => existingRouteUrls.add(url));
      }
    }
  });

  // Apply maxRoutes limit if specified
  if (config.maxRoutes && config.maxRoutes > 0) {
    allRoutes.splice(config.maxRoutes);
  }

  if (allRoutes.length === 0) {
    console.log(`⚠️ No routes found matching criteria: Business Criticality [${config.businessCriticalityFilter.join(', ')}], Testing Priority [${config.testingPriorityFilter.join(', ')}]`);
    return;
  }

  // Essential summary logs
  console.log(`Found ${allRoutes.length} menus, ${allRoutes.reduce((sum, route) => sum + route.routes.length, 0)} total routes to process.`);
  
  // Create output directory structure
  const outputDir = path.join(process.cwd(), config.outputDir);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Track processed URLs to avoid duplicates
  const processedUrls = new Set();
  let processedCount = 0;

  // Generate crawl data for each filtered route
  for (let i = 0; i < allRoutes.length; i++) {
    const route = allRoutes[i];
    // Only high-level progress log
    console.log(`Processing menu ${i + 1}/${allRoutes.length}: ${route.menuName}`);

    for (let j = 0; j < route.routes.length; j++) {
      const targetUrl = route.routes[j];
      let correctDomain = routesData.explorationDomain || process.env.BASE_URL;
      const fullUrl = targetUrl.startsWith('http') ? targetUrl : `${correctDomain}${targetUrl}`;

      if (skippedLogoutRoutes.has(fullUrl.toLowerCase())) {
        continue;
      }

      if (processedUrls.has(fullUrl)) {
        continue;
      }
      processedUrls.add(fullUrl);
      processedCount++;

      let routePath;
      if (targetUrl.startsWith('http')) {
        const urlObj = new URL(targetUrl);
        routePath = urlObj.pathname;
      } else {
        routePath = targetUrl.split('?')[0];
      }

      const pathSegments = routePath.split('/').filter(Boolean);

      const routeDir = path.join(outputDir, ...pathSegments);
      if (!fs.existsSync(routeDir)) {
        fs.mkdirSync(routeDir, { recursive: true });
      }

      const outputFile = 'raw-dom.json';
      const outputPath = path.join(routeDir, outputFile);

      try {
        const { chromium } = require('playwright');
        const browser = await chromium.launch({ 
          headless: false,
          slowMo: 1000
        });
        let storageState = null;
        try {
          if (fs.existsSync('storage-state.json')) {
            storageState = JSON.parse(fs.readFileSync('storage-state.json', 'utf8'));
          } else {
            throw new Error('Storage state file not found');
          }
        } catch (error) {
          throw error;
        }
        const context = await browser.newContext({
          storageState: storageState
        });
        const page = await context.newPage();
        try {
          await page.setViewportSize({ width: 1280, height: 800 });
          if (process.env.USER_AGENT) {
            await page.setExtraHTTPHeaders({
              'User-Agent': process.env.USER_AGENT,
            });
          }
          await page.goto(fullUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
          });
          await page.waitForLoadState('domcontentloaded');
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(5000);
          const pageData = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*')).map(el => ({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              name: el.getAttribute('name'),
              type: el.getAttribute('type'),
              role: el.getAttribute('role'),
              testId: el.getAttribute('data-testid'),
              ariaLabel: el.getAttribute('aria-label'),
              placeholder: el.getAttribute('placeholder'),
              text: el.innerText?.trim() || null,
              attributes: Array.from(el.attributes).reduce((acc, attr) => {
                acc[attr.name] = attr.value;
                return acc;
              }, {}),
            }));
            return {
              metadata: {
                title: document.title,
                url: window.location.href,
                userAgent: navigator.userAgent,
              },
              elements,
            };
          });
          fs.writeFileSync(outputPath, JSON.stringify([pageData], null, 2));
        } finally {
          await context.close();
          await browser.close();
        }
      } catch (error) {
        console.error(`Failed to crawl ${targetUrl}:`, error.message);
      }
    }
  }

  // Create a summary file for processed routes
  const summaryFile = path.join(outputDir, 'crawl-summary.json');
  const summary = {
    filterCriteria: {
      businessCriticality: config.businessCriticalityFilter,
      testingPriority: config.testingPriorityFilter
    },
    totalMenusFound: allRoutes.length,
    totalIndividualRoutes: allRoutes.reduce((sum, route) => sum + route.routes.length, 0),
    uniqueRoutesProcessed: processedCount,
    duplicatesSkipped: allRoutes.reduce((sum, route) => sum + route.routes.length, 0) - processedCount,
    outputDirectory: config.outputDir,
    generatedAt: new Date().toISOString(),
    note: 'Each route contains raw-dom.json file with complete DOM structure. All sub-routes in each menu are processed. Includes both main navigation and extracted navigation routes.',
    processedRoutes: Array.from(processedUrls).map(url => {
      const routePath = url.includes('://') ? new URL(url).pathname : url;
      const pathSegments = routePath.split('/').filter(Boolean);
      return {
        url: url,
        routePath: routePath,
        directoryPath: pathSegments.join('/'),
        filePath: `${config.outputDir}/${pathSegments.join('/')}/raw-dom.json`
      };
    })
  };

  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  // Essential summary log
  console.log(`Summary saved to: ${path.relative(process.cwd(), summaryFile)}`);
  console.log(`Processed ${processedCount} unique routes from ${allRoutes.length} menus.`);
}

module.exports = {
  generateCrawlData
};