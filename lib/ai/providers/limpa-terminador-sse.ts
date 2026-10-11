/**
 * Provedor personalizado (#1642): o gateway do operador pode devolver o JSON
 * inteiro com o terminador SSE colado no fim (`{...}}data: [DONE]\n\n`) — JSON
 * válido, terminador ilegítimo. O SDK lê o corpo pelo handler de JSON,
 * `JSON.parse` engasga no `data: [DONE]` e o turno morre com
 * "Invalid JSON response" (HTTP 200).
 *
 * Só corta quando o trecho ANTES do primeiro `data:` já é JSON completo — é a
 * assinatura do terminador colado, e nada mais. Corpo que já começa em `data:`
 * (stream de verdade, com N chunks) e JSON legítimo que só MENCIONA `data:` (o
 * prefixo aí não fecha em JSON) passam intactos; sem essa guarda isto viraria
 * regressão.
 *
 * A guarda NÃO é pelo `content-type`. O 9Router manda `text/event-stream`
 * mesmo quando responde um JSON único não-stream — foi medido: com a guarda por
 * content-type o terminador continuava colado e o turno seguia morto. Quem
 * separa os dois é o CRITÉRIO DO CONTEÚDO: se o prefixo antes do primeiro
 * `data:` já é JSON inteiro, o `data:` é terminador colado; se o corpo começa
 * por `data:` (stream real), o prefixo não é JSON e nada é cortado.
 */
export function limpaTerminadorSse(interno: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await interno(input, init);
    // Resposta sem corpo passa intacta: em 204/205/304 o construtor de Response
    // recusa qualquer corpo.
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
