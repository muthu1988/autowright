class OllamaClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'qwen2.5:7b';
    this.temperature = options.temperature ?? 0.2;
    this.timeout = options.timeout || 300000; // 5 minutes default timeout
  }

  async generate(prompt, label = 'unknown') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const start = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: this.temperature,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama error: ${text}`);
      }

      const data = await response.json();
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ⏱  LLM [${label}] — ${secs}s (prompt: ${prompt.length} chars, response: ${(data.response ?? '').length} chars, model: ${this.model})`);
      return data.response;
    } catch (error) {
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      if (error.name === 'AbortError') {
        console.log(`  ❌ LLM [${label}] — timed out after ${secs}s`);
        throw new Error(`LLM request timed out after ${this.timeout / 1000} seconds`);
      }
      console.log(`  ❌ LLM [${label}] — failed after ${secs}s: ${error.message}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

module.exports = OllamaClient;
