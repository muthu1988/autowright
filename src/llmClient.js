class OllamaClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'qwen2.5:7b';
    this.temperature = options.temperature ?? 0.2;
    this.timeout = options.timeout || 300000; // 5 minutes default timeout
  }

  async generate(prompt) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

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
      return data.response;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${this.timeout / 1000} seconds`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

module.exports = OllamaClient;
