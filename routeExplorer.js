const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class RouteExplorer {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl;
    this.startUrl = options.startUrl;
    this.storageState = options.storageState || null;
    this.maxPages = options.maxPages || 20;
    this.maxRetries = options.maxRetries || 2; // New retry option

    // Use the domain from startUrl for internal link detection
    this.explorationDomain = new URL(this.startUrl).origin;

    this.visited = new Set();
    this.queue = [];
    this.routes = [];
    this.failedRoutes = []; // Track failed routes
    this.skippedLogoutRoutes = []; // Track skipped logout routes
    this.retryAttempts = new Map(); // Track retry attempts per URL
    this.navigationStructure = new Map(); // Track navigation menus from DOM
    this.menuHierarchy = []; // Organized menu structure
  }

  isInternal(url) {
    try {
      const parsed = new URL(url);
      // Use exploration domain instead of baseUrl for internal link detection
      return parsed.origin === this.explorationDomain;
    } catch {
      return false;
    }
  }

  shouldSkipRoute(url) {
    const lowercaseUrl = url.toLowerCase();
    const logoutPatterns = [
      'logout', 'logout', 'sign-out', 'signout', 
      'sign_out', '/exit', '/quit', '/disconnect',
      'end-session', 'endsession', 'terminate'
    ];
    
    return logoutPatterns.some(pattern => 
      lowercaseUrl.includes(pattern)
    );
  }

  /**
   * Extract navigation menu structure from the current page DOM
   */
  async extractNavigationStructure(page, currentUrl) {
    try {
      const navigation = await page.evaluate(() => {
        const navData = {
          mainMenus: [],
          subMenus: [],
          breadcrumbs: [],
          sidebarMenus: [],
          currentPage: window.location.pathname
        };

        // Common navigation selectors
        const navSelectors = [
          'nav', '[role="navigation"]', '.navbar', '.nav', '.navigation',
          '.menu', '.main-nav', '.primary-nav', '.header-nav', '.top-nav'
        ];

        const sidebarSelectors = [
          '.sidebar', '.side-nav', '.sidebar-nav', '.left-nav', '.secondary-nav',
          '.menu-sidebar', '[role="complementary"]', '.app-sidebar'
        ];

        const breadcrumbSelectors = [
          '.breadcrumb', '.breadcrumbs', '[aria-label*="breadcrumb"]', 
          '.page-path', '.navigation-path'
        ];

        // Extract main navigation
        navSelectors.forEach(selector => {
          const navElements = document.querySelectorAll(selector);
          navElements.forEach((nav, index) => {
            const menuItems = [];
            const links = nav.querySelectorAll('a[href]');
            
            links.forEach(link => {
              const href = link.getAttribute('href');
              const text = link.textContent?.trim();
              const isActive = link.closest('li')?.classList.contains('active') || 
                             link.classList.contains('active') ||
                             link.getAttribute('aria-current') === 'page';
              
              if (href && text && href.startsWith('/')) {
                menuItems.push({
                  text: text,
                  href: href,
                  isActive: isActive,
                  level: 1
                });
              }
            });

            if (menuItems.length > 0) {
              navData.mainMenus.push({
                selector: selector,
                index: index,
                items: menuItems
              });
            }
          });
        });

        // Extract sidebar navigation
        sidebarSelectors.forEach(selector => {
          const sidebarElements = document.querySelectorAll(selector);
          sidebarElements.forEach((sidebar, index) => {
            const menuItems = [];
            
            // Look for nested menu structure
            const topLevelItems = sidebar.querySelectorAll('li, .menu-item');
            topLevelItems.forEach(item => {
              const link = item.querySelector('a[href]');
              if (link) {
                const href = link.getAttribute('href');
                const text = link.textContent?.trim();
                const isActive = item.classList.contains('active') || 
                               link.classList.contains('active');
                
                // Check for sub-menu items
                const subItems = [];
                const subLinks = item.querySelectorAll('ul a[href], .submenu a[href]');
                subLinks.forEach(subLink => {
                  const subHref = subLink.getAttribute('href');
                  const subText = subLink.textContent?.trim();
                  if (subHref && subText && subHref.startsWith('/')) {
                    subItems.push({
                      text: subText,
                      href: subHref,
                      level: 2,
                      parent: text
                    });
                  }
                });

                if (href && text && href.startsWith('/')) {
                  menuItems.push({
                    text: text,
                    href: href,
                    isActive: isActive,
                    level: 1,
                    subItems: subItems
                  });
                }
              }
            });

            if (menuItems.length > 0) {
              navData.sidebarMenus.push({
                selector: selector,
                index: index,
                items: menuItems
              });
            }
          });
        });

        // Extract breadcrumbs
        breadcrumbSelectors.forEach(selector => {
          const breadcrumbElements = document.querySelectorAll(selector);
          breadcrumbElements.forEach(breadcrumb => {
            const items = [];
            const links = breadcrumb.querySelectorAll('a[href], span');
            
            links.forEach((item, index) => {
              const text = item.textContent?.trim();
              const href = item.getAttribute('href');
              
              if (text) {
                items.push({
                  text: text,
                  href: href || null,
                  position: index,
                  isLast: index === links.length - 1
                });
              }
            });

            if (items.length > 0) {
              navData.breadcrumbs = items;
            }
          });
        });

        return navData;
      });

      // Store navigation data for this route
      this.navigationStructure.set(this.normalize(currentUrl), navigation);
      
      // Log discovered navigation elements
      const totalNavItems = navigation.mainMenus.reduce((sum, nav) => sum + nav.items.length, 0) +
                           navigation.sidebarMenus.reduce((sum, nav) => sum + nav.items.length, 0);
      
      if (totalNavItems > 0) {
        console.log(`   📋 Found ${totalNavItems} navigation items (${navigation.mainMenus.length} main nav, ${navigation.sidebarMenus.length} sidebar)`);
      }

      return navigation;

    } catch (error) {
      console.log(`   ⚠️ Could not extract navigation from ${currentUrl}: ${error.message}`);
      return null;
    }
  }

  /**
   * Organize collected navigation data into coherent menu hierarchy
   */
  organizeMenuHierarchy() {
    const menuGroups = new Map();
    const allMenuItems = new Set();

    // Collect all unique menu items from all pages
    this.navigationStructure.forEach((navigation, route) => {
      // Process main navigation
      navigation.mainMenus.forEach(nav => {
        nav.items.forEach(item => {
          const menuKey = item.text.toLowerCase().trim();
          if (!menuGroups.has(menuKey)) {
            menuGroups.set(menuKey, {
              menuName: item.text,
              menuType: 'main',
              routes: new Set(),
              subMenus: new Map(),
              pages: new Set(),
              isNavigationMenu: true
            });
          }
          
          const menuGroup = menuGroups.get(menuKey);
          menuGroup.routes.add(item.href);
          menuGroup.pages.add(route);
          allMenuItems.add(item.href);
        });
      });

      // Process sidebar navigation with sub-menus
      navigation.sidebarMenus.forEach(nav => {
        nav.items.forEach(item => {
          const menuKey = item.text.toLowerCase().trim();
          if (!menuGroups.has(menuKey)) {
            menuGroups.set(menuKey, {
              menuName: item.text,
              menuType: 'main',
              routes: new Set(),
              subMenus: new Map(),
              pages: new Set(),
              isNavigationMenu: true
            });
          }

          const menuGroup = menuGroups.get(menuKey);
          menuGroup.routes.add(item.href);
          menuGroup.pages.add(route);

          // Process sub-menu items
          item.subItems?.forEach(subItem => {
            const subKey = subItem.text.toLowerCase().trim();
            if (!menuGroup.subMenus.has(subKey)) {
              menuGroup.subMenus.set(subKey, {
                subMenuName: subItem.text,
                routes: new Set(),
                parent: item.text
              });
            }
            menuGroup.subMenus.get(subKey).routes.add(subItem.href);
            allMenuItems.add(subItem.href);
          });
        });
      });
    });

    // Identify standalone routes (not in any navigation menu)
    const standaloneRoutes = this.routes.filter(route => !allMenuItems.has(route));
    if (standaloneRoutes.length > 0) {
      menuGroups.set('standalone_pages', {
        menuName: 'Standalone Pages',
        menuType: 'standalone',
        routes: new Set(standaloneRoutes),
        subMenus: new Map(),
        pages: new Set(),
        isNavigationMenu: false
      });
    }

    // Convert to final structure
    this.menuHierarchy = Array.from(menuGroups.values()).map(group => ({
      menuName: group.menuName,
      menuType: group.menuType,
      routes: Array.from(group.routes),
      subMenus: Array.from(group.subMenus.values()).map(sub => ({
        subMenuName: sub.subMenuName,
        routes: Array.from(sub.routes),
        parent: sub.parent
      })),
      routeCount: group.routes.size,
      isNavigationMenu: group.isNavigationMenu
    }));

    console.log(`\n🗂️ Organized routes into ${this.menuHierarchy.length} menu groups:`);
    this.menuHierarchy.forEach((menu, index) => {
      const subMenuText = menu.subMenus.length > 0 ? ` + ${menu.subMenus.length} sub-menus` : '';
      console.log(`   ${index + 1}. ${menu.menuName} (${menu.routeCount} routes${subMenuText})`);
    });

    return this.menuHierarchy;
  }

  normalize(url) {
    const parsed = new URL(url);
    return parsed.pathname;
  }

  async explore() {
    console.log(`🔍 Exploration domain: ${this.explorationDomain}`);
    console.log(`🔍 Base URL (auth): ${this.baseUrl}`);
    
    const browser = await chromium.launch({ headless: false });

    const context = await browser.newContext({
      storageState: this.storageState || undefined,
    });

    const page = await context.newPage();

    this.queue.push(this.startUrl);

    while (this.queue.length > 0 && this.routes.length < this.maxPages) {
      const url = this.queue.shift();

      if (this.visited.has(url)) continue;
      this.visited.add(url);

      console.log(`Visiting: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

        const links = await page.$$eval('a[href]', anchors =>
          anchors.map(a => a.href)
        );

        this.routes.push(this.normalize(url));
        console.log(`✅ Successfully visited ${url}, found ${links.length} links`);

        // Extract navigation structure from this page
        await this.extractNavigationStructure(page, url);

        for (const link of links) {
          if (!this.isInternal(link)) continue;

          // Skip logout and session termination routes
          if (this.shouldSkipRoute(link)) {
            this.skippedLogoutRoutes.push(link);
            console.log(`🚫 Skipping logout route: ${link}`);
            continue;
          }

          const normalized = this.normalize(link);
          const full = new URL(normalized, this.explorationDomain).toString();

          if (!this.visited.has(full)) {
            this.queue.push(full);
          }
        }

      } catch (err) {
        const currentAttempts = this.retryAttempts.get(url) || 0;
        
        if (currentAttempts < this.maxRetries) {
          // Retry the failed route
          this.retryAttempts.set(url, currentAttempts + 1);
          console.log(`🔄 Retrying ${url} (attempt ${currentAttempts + 2}/${this.maxRetries + 1}): ${err.message}`);
          
          // Add back to queue for retry (with delay)
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
          this.queue.push(url);
          this.visited.delete(url); // Remove from visited so it can be retried
          
        } else {
          // Max retries exhausted, add to failed routes
          const failedRoute = {
            url: url,
            normalizedPath: this.normalize(url),
            error: err.message,
            errorType: err.name || 'Unknown',
            retryAttempts: currentAttempts + 1,
            timestamp: new Date().toISOString()
          };
          
          this.failedRoutes.push(failedRoute);
          console.log(`❌ Failed to visit ${url} after ${currentAttempts + 1} attempts: ${err.message}`);
          console.log(`   Error type: ${err.name || 'Unknown'}`);
        }
      }
    }

    await browser.close();

    // Organize navigation hierarchy from collected data
    const menuHierarchy = this.organizeMenuHierarchy();

    console.log(`\n📊 Route Discovery Summary:`);
    console.log(`   ✅ Successful routes: ${this.routes.length}`);
    console.log(`   ❌ Failed routes: ${this.failedRoutes.length}`);
    console.log(`   🚫 Skipped logout routes: ${this.skippedLogoutRoutes.length}`);
    console.log(`   🗂️ Navigation menus identified: ${menuHierarchy.length}`);
    console.log(`   🔄 Max retries per route: ${this.maxRetries}`);
    console.log(`   🔗 Total attempted: ${this.routes.length + this.failedRoutes.length}`);

    const output = {
      baseUrl: this.baseUrl,
      explorationDomain: this.explorationDomain,
      discoveredRoutes: this.routes,
      failedRoutes: this.failedRoutes,
      skippedLogoutRoutes: [...new Set(this.skippedLogoutRoutes)], // Remove duplicates
      navigationStructure: menuHierarchy,
      navigationMetadata: {
        totalMenus: menuHierarchy.length,
        mainMenus: menuHierarchy.filter(m => m.menuType === 'main').length,
        standalonePages: menuHierarchy.filter(m => m.menuType === 'standalone').length,
        totalSubMenus: menuHierarchy.reduce((sum, menu) => sum + menu.subMenus.length, 0),
        navigationPagesScanned: this.navigationStructure.size
      },
      configuration: {
        maxRetries: this.maxRetries,
        timeoutMs: 120000,
        skipLogout: true,
        extractNavigation: true
      },
      summary: {
        successful: this.routes.length,
        failed: this.failedRoutes.length,
        skippedLogout: this.skippedLogoutRoutes.length,
        navigationMenus: menuHierarchy.length,
        maxRetries: this.maxRetries,
        total: this.routes.length + this.failedRoutes.length,
        timestamp: new Date().toISOString()
      }
    };

    // Ensure output directory exists
    const outputDir = 'output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'routes.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify(output, null, 2)
    );

    console.log('Route discovery complete.');

    return output;
  }
}

module.exports = RouteExplorer;