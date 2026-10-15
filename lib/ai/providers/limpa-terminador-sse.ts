/**
 * Provedor personalizado (#1642): o gateway do operador pode devolver o JSON
 * inteiro com o terminador SSE colado no fim (`{...}}data: [DONE]\n\n`) — JSON
 * válido, terminador ilegítimo. O SDK lê o corpo pelo handler de JSON,
 * `JSON.parse` engasga no `data: [DONE]` e o turno morre com
 * "Invalid JSON response" (HTTP 200).
 *
 * ═══ O DEFEITO QUE A PRIMEIRA VERSÃO NÃO COBRIA (medido 2026-10-15) ═══
 *
 * A primeira versão procurava o PRIMEIRO `data:` do corpo e cortava ali. Isso
 * funciona quando o JSON não menciona a palavra — e falha exatamente quando ele
 * menciona: o modelo escreve "dados do cliente", "dados pessoais", "atualizar os
 * dados" com frequência num CRM, e o `data:` de DENTRO da string JSON vira o
 * ponto de corte. O prefixo resultante é JSON TRUNCADO, `eJson(prefixo)` devolve
 * `false`, a guarda entende "isto é um stream de verdade" e o corpo passa
 * intacto — com o terminador colado. O SDK então faz `JSON.parse` no corpo todo
 * e o turno morre com "Invalid JSON response".
 *
 * Medido nesta instalação: **compaction falhava 75 de 89 chamadas em 24h (84%)**,
 * e cada falha custa uma re-tentativa do turno (~45s de espera a mais para o
 * lead). O sintoma não aparecia em teste porque a resposta curta quase nunca
 * contém a palavra.
 *
 * ═══ A REGRA CERTA: o terminador é o que vem DEPOIS do JSON ═══
 *
 * Não é o primeiro `data:` — é o `data:` que sobra quando o JSON já fechou. O
 * corte passa a ser o fim do primeiro objeto JSON BALANCEADO (contando chaves,
 * respeitando string e escape), e só se o que sobra depois dele for um
 * terminador SSE (`data:` + `[DONE]`, com ou sem espaços).
 *
 * Três formas continuam intocadas, de propósito:
 *   - corpo que já começa em `data:` (stream de verdade, vários chunks) — não é
 *     JSON, o balanceador não acha objeto e nada é cortado;
 *   - JSON legítimo que só MENCIONA `data:` por dentro — o objeto balanceado
 *     termina antes, e o que sobra não é terminador;
 *   - corpo sem terminador nenhum — nada a fazer.
 */

/** Fecha o primeiro objeto JSON a partir de `inicio`, respeitando string e escape. */
function fimDoJson(texto: string, inicio: number): number {
  let profundidade = 0;
  let emString = false;
  let escapado = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (escapado) {
      escapado = false;
      continue;
    }
    if (c === '\\') {
      escapado = true;
      continue;
    }
    if (c === '"') {
      emString = !emString;
      continue;
    }
    if (emString) continue;
    if (c === '{') profundidade++;
    else if (c === '}') {
      profundidade--;
      // `<= 0` de propósito: um corpo malformado com `}` a mais não deve
      // devolver -1 e fazer o chamador tratar como "sem terminador".
      if (profundidade <= 0) return i + 1;
    }
  }
  return -1;
}

/** O que sobra depois do JSON é um terminador SSE? Só então o corte é legítimo. */
function eTerminadorSse(resto: string): boolean {
  const t = resto.trim();
  if (t === '') return true;
  return /^data:\s*(\[DONE\])?\s*$/.test(t);
}

export function limpaTerminadorSse(interno: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await interno(input, init);
    // Resposta sem corpo passa intacta: em 204/205/304 o construtor de Response
    // recusa qualquer corpo.
    if (res.status === 204 || res.status === 205 || res.status === 304) return res;
    const texto = await res.text();
    // Corpo que já COMEÇA em `data:` é stream de verdade (N eventos, um por
    // linha). O terminador colado é o contrário: um documento JSON único, e só
    // depois dele o `data:` que sobra. Sem esta guarda, o primeiro evento de um
    // stream cujo conteúdo fecha um objeto seria cortado — o stream perderia
    // todos os chunks seguintes.
    if (texto.trimStart().startsWith('data:')) return recompor(res, texto);
    const inicio = texto.indexOf('{');
    const fim = inicio === -1 ? -1 : fimDoJson(texto, inicio);
    if (fim === -1 || !eTerminadorSse(texto.slice(fim))) return recompor(res, texto);
    const enxuto = texto.slice(0, fim);
    // O corpo encurtou: `content-length` e a codificação originais mentiriam.
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(enxuto, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

function recompor(res: Response, texto: string): Response {
  return new Response(texto, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
