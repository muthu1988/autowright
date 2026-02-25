const fs = require('fs');
const path = require('path');
const OllamaClient = require('./llmClient');

class DomAnalyzer {
  constructor(options = {}) {
    this.inputFile = options.inputFile || 'raw-dom.json';
    this.outputFile = options.outputFile || 'analysis-output.json';

    this.client = new OllamaClient({
      model: options.model || 'qwen2.5:7b',
      temperature: 0.1,
    });
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

    const simplified = {
      metadata: page.metadata,
      interactiveElements: interactive.slice(0, 200),
    };

    const prompt = `
You are a senior QA automation engineer.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanations.
Do not include backticks.

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

    // ✅ Inject URL from crawler metadata (guaranteed correct)
    parsed.url = page.metadata.url;

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

    console.log(`Analysis saved to ${outputPath}`);

    return parsed;
  }

  async extractAuthSelectors(existingAnalysis = null) {
    const analysis = existingAnalysis || await this.analyze();

    if (analysis.pageType !== 'login') {
      throw new Error('Page is not identified as a login page');
    }

    const prompt = `You are a senior QA automation engineer.

    Based on the following page analysis, extract the most reliable Playwright selectors for username/email input, password input, and submit button.

    Return ONLY valid JSON in the following format:
    {
      "usernameSelector": "...",
      "passwordSelector": "...",
      "submitSelector": "..."

    }
    PAGE ANALYSIS:
    ${JSON.stringify(analysis, null, 2)}
    `;

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