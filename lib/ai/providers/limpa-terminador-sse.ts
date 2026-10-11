/**
 * Provedor personalizado (#1642): o gateway do operador pode devolver o JSON
 * inteiro com o terminador SSE colado no fim (`{...}}data: [DONE]\n\n`) — JSON
 * válido, terminador ilegítimo. O SDK lê o corpo pelo handler de JSON,
 * `JSON.parse` engasga no `data: [DONE]` e o turno morre com
 * "Invalid JSON response" (HTTP 200).
 *
 * Só corta quando o trecho ANTES do primeiro `data:` já é JSON completo — é a
 * assinatura do terminador colado, e nada mais. `text/event-stream`, corpo que
 * já começa em `data:` e JSON legítimo que só MENCIONA `data:` (o prefixo aí não
 * fecha em JSON) passam intactos; sem a guarda isto viraria regressão.
 */
export function limpaTerminadorSse(interno: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await interno(input, init);
    const contentType = res.headers.get("content-type") ?? "";
    // Stream de verdade e resposta sem corpo passam intactos: em 204/205/304 o
    // construtor de Response recusa qualquer corpo.
    if (contentType.includes("text/event-stream")) return res;
    if (res.status === 204 || res.status === 205 || res.status === 304) return res;
    const texto = await res.text();
    const corte = texto.indexOf("data:");
    const prefixo = corte === -1 ? "" : texto.slice(0, corte).trim();
    if (corte === -1 || !eJson(prefixo)) return recompor(res, texto);
    // O corpo encurtou: `content-length` e a codificação originais mentiriam.
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(texto.slice(0, corte).trimEnd(), {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

/** O prefixo tem cara de JSON inteiro? É o que separa terminador colado de stream. */
function eJson(prefixo: string): boolean {
  try {
    JSON.parse(prefixo);
    return true;
  } catch {
    return false;
  }
}

function recompor(res: Response, texto: string): Response {
  return new Response(texto, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
