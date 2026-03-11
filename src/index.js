/**
 * AutoWright - Main module exports
 * Playwright test automation pipeline with dynamic analysis and AI-driven test generation
 */

const authentication = require('./authentication');
const routeDiscovery = require('./route-discovery');
const domAnalysis = require('./dom-analysis');
const mcpIntegration = require('./mcp-integration');
const services = require('./services');

module.exports = {
  authentication,
  routeDiscovery,
  domAnalysis,
  mcpIntegration,
  services
};