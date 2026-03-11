/**
 * DOM analysis module exports
 * Handles DOM extraction, analysis, and snapshot generation
 */

const DomAnalyzer = require('./domAnalyzer');
const DomCrawler = require('./domCrawler');
const { generateCrawlData } = require('./snapshotGenerator');

module.exports = {
  DomAnalyzer,
  DomCrawler,
  generateCrawlData
};