import type { LLMAdapter, AgentMessage, AgentResult, AgentToolDefinition } from "./adapter";
import { readFileSync } from "node:fs";
import path from "node:path";

// El SDK no está acoplado al ciclo; cambiar el proveedor solo reemplaza este adaptador.
export class GeminiAdapter implements LLMAdapter {
  provider = "Google Gemini";
  model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  private prompt = readFileSync(path.join(process.cwd(), "agent/prompt.md"), "utf8");
  async enviar(messages: AgentMessage[], tools: AgentToolDefinition[]): Promise<AgentResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("MODELO_NO_CONFIGURADO");
    const timeoutMs = Math.max(2500, Math.min(Number(process.env.GEMINI_TIMEOUT_MS || 8000), 25000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
      const response = await fetch(url, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: this.prompt }] },
          contents: messages,
          ...(tools.length ? { tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
          generationConfig: { temperature: 0, maxOutputTokens: 450 }
        })
      });
      if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const candidate = (payload as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> }).candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const calls: AgentResult["calls"] = [];
      let text = "";
      for (const p of parts) {
        if (typeof p.text === "string") text += p.text;
        const call = p.functionCall as {name?:string;args?:Record<string,unknown>;id?:string}|undefined;
        if (call?.name) calls.push({name:call.name, args:call.args || {}, id:call.id});
      }
      return { text, calls, modelParts: parts };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new Error("LLM_TIMEOUT");
      throw err;
    } finally { clearTimeout(timer); }
  }
}
