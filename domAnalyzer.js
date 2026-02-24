const fs = require('fs');
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
    const rawData = JSON.parse(
      fs.readFileSync(this.inputFile, 'utf-8')
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

    // ✅ Save clean formatted JSON only
    fs.writeFileSync(
      this.outputFile,
      JSON.stringify(parsed, null, 2)
    );

    console.log(`Analysis saved to ${this.outputFile}`);

    return parsed;
  }
}

module.exports = DomAnalyzer;