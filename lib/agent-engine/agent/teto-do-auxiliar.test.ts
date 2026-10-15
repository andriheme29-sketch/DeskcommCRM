/**
 * O teto de relógio do auxiliar precisa ABORTAR de verdade.
 *
 * O defeito medido: o `Promise.all` do turno espera o mais lento, e os
 * classificadores advisórios não tinham teto — `jailbreak_detect` e
 * `stage_classifier` chegaram a 908s na `llm_calls`, segurando a resposta do
 * cliente. Os dois degradam no `catch` (o turno segue sem o sinal), então o que
 * a camada precisa é só parar de poder custar 15 minutos.
 *
 * O que este arquivo trava é o contrato do `AbortSignal`: ele aborta no prazo
 * informado e não antes. O `runModelCall` já respeita `abortSignal` pelo mesmo
 * caminho que o `count-tokens` usa — o que faltava era alguém PASSAR um.
 */
import { describe, expect, it } from 'vitest';

import { sinalDoAuxiliar, TETO_AUXILIAR_MS } from './teto-do-auxiliar';

describe('teto do classificador auxiliar', () => {
  it('o teto é folgado para um classificador barato e curto para o cliente', () => {
    // p50 medido em produção: 2s (jailbreak) e 5s (estágio). O teto não pode
    // cortar o caso comum, e não pode ser tão alto que o gargalo continue.
    expect(TETO_AUXILIAR_MS).toBe(8_000);
    expect(TETO_AUXILIAR_MS).toBeGreaterThan(5_000);
    expect(TETO_AUXILIAR_MS).toBeLessThan(30_000);
  });

  it('o sinal nasce aberto e aborta no prazo', async () => {
    const sinal = sinalDoAuxiliar(20);
    expect(sinal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(sinal.aborted).toBe(true);
  });

  it('o aborto chega como erro — o catch do classificador degrada, nunca veta o turno', async () => {
    const sinal = sinalDoAuxiliar(10);
    // Mesmo formato que o `fetch` do runModelCall produz ao ser abortado.
    const pendente = new Promise((_ok, rejeita) => {
      sinal.addEventListener('abort', () => rejeita(sinal.reason));
    });
    await expect(pendente).rejects.toBeDefined();
  });
});
