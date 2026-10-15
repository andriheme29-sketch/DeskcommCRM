/**
 * O terminador SSE colado só pode ser cortado pelo FIM do JSON, nunca pelo
 * primeiro `data:` do corpo.
 *
 * ─── O defeito medido (2026-10-15) ───────────────────────────────────────────
 *
 * A primeira versão cortava no primeiro `data:`. Num CRM, o modelo escreve
 * "dados do cliente", "dados pessoais", "atualizar os dados" o tempo todo — e o
 * `data:` dentro da string JSON virava o ponto de corte. O prefixo resultante era
 * JSON truncado, a guarda `eJson` devolvia `false`, e o corpo seguia intacto com
 * o terminador colado.
 *
 * Resultado em produção: `compaction` falhando **75 de 89** chamadas em 24h
 * (84%) com "Invalid JSON response". Cada falha faz o turno re-tentar, e a
 * espera do lead sobe ~45s. Um turno real medido no log: 45s + 9s + 10s de
 * re-tentativa antes de a resposta sair.
 *
 * O caso 3 abaixo é o corpo REAL capturado do gateway nesta instalação.
 */
import { describe, expect, it } from 'vitest';

import { limpaTerminadorSse } from './limpa-terminador-sse';

const TERMINADOR = 'data: [DONE]\n\n';

function fetchQueDevolve(corpo: string, ct = 'text/event-stream'): typeof fetch {
  return (async () =>
    new Response(corpo, { status: 200, headers: { 'content-type': ct } })) as unknown as typeof fetch;
}

async function corpoEntregue(corpo: string): Promise<string> {
  const res = await limpaTerminadorSse(fetchQueDevolve(corpo))('http://x', {});
  return res.text();
}

describe('limpaTerminadorSse: corta o terminador colado, e só ele', () => {
  it('corta o terminador quando o JSON não menciona "data:"', async () => {
    const json = '{"notes":[{"headline":"Preco","body":"R$ 297"}]}';
    expect(await corpoEntregue(json + TERMINADOR)).toBe(json);
  });

  /**
   * O caso que quebrava: a palavra `dados`/`data:` DENTRO da string JSON.
   * O primeiro `data:` está no meio do texto; o terminador está no fim.
   */
  it('NÃO corta no "data:" de dentro da string — o defeito de 84%', async () => {
    const json = JSON.stringify({
      commitments: ['Enviar os dados do cliente para o laboratorio'],
      objections: ['vou ver os dados e te falo'],
      personal_data: ['Fabiana, 45 anos'],
      stage: 'negotiating',
      rolling_summary: 'Cliente pediu os dados da entrega: data: de entrega e preco.',
    });
    // O corpo MENCIONA `data:` (com os dois-pontos) DENTRO da string JSON — é a
    // forma que o defeito usava para cortar no lugar errado.
    expect(json.indexOf('data:')).toBeGreaterThan(-1);
    expect(await corpoEntregue(json + TERMINADOR)).toBe(json);
  });

  it('o corpo REAL do gateway (com "dados" no meio) sai intacto e parseável', async () => {
    // Reprodução fiel do que o 9Router devolveu: JSON completo + terminador.
    const real =
      '{"id":"chatcmpl-0ace4a48","object":"chat.completion","model":"deepseek-v4.1-flash",' +
      '"choices":[{"index":0,"message":{"role":"assistant","content":"{\\"commitments\\":[],' +
      '\\"objections\\":[],\\"personal_data\\":[],\\"stage\\":null,\\"rolling_summary\\":' +
      '\\"Nenhum compromisso, dados ou avanco na negociacao.\\"}"},"finish_reason":"stop"}],' +
      '"usage":{"prompt_tokens":3,"completion_tokens":444}}';
    const entregue = await corpoEntregue(real + TERMINADOR);
    expect(entregue).toBe(real);
    expect(() => JSON.parse(entregue)).not.toThrow();
  });

  it('stream de verdade (começa em "data:") passa intacto', async () => {
    const stream = 'data: {"choices":[{"delta":{"content":"oi"}}]}\n\ndata: [DONE]\n\n';
    expect(await corpoEntregue(stream)).toBe(stream);
  });

  it('JSON legítimo sem terminador passa intacto', async () => {
    const json = '{"stage":"negotiating"}';
    expect(await corpoEntregue(json)).toBe(json);
  });

  it('204/205/304 passam sem tocar no corpo', async () => {
    const res = await limpaTerminadorSse(
      (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    )('http://x', {});
    expect(res.status).toBe(204);
  });
});
