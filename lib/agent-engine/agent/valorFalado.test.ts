/**
 * O PRECO QUE A VOZ FALA — regressão medida, não hipótese.
 *
 * Medido em 13/10/2026 com a voz real da operação (Fish `s2.1-pro-free`) e a
 * transcrição real (Scribe v1), 3 rodadas por variante: a MESMA frase de oferta
 * com `R$ 985`/`R$ 397` voltou com números DIFERENTES a cada rodada ("997,00 /
 * 285,00 / 99,80" numa; "188 / 29,97" na outra), enquanto a versão por extenso
 * voltou correta em 3 de 3. Em áudio de OFERTA isso é o cliente ouvindo outro
 * preço — o defeito mais caro que este módulo podia ter.
 */
import { describe, expect, it } from "vitest";

import { corpoParaVoz, valorFalado } from "./voz-do-turno";

describe("valorFalado — o que a voz lê", () => {
  it("tira o cifrão: `R$ 397` vira `397 reais` (a forma que voltou certa 3/3)", () => {
    expect(valorFalado("hoje você paga somente R$ 397 mais o frete grátis")).toBe(
      "hoje você paga somente 397 reais mais o frete grátis",
    );
  });

  it("mantém o separador de milhar como está escrito", () => {
    expect(valorFalado("custa R$ 1.485,00 fora da promoção")).toBe(
      "custa 1.485 reais fora da promoção",
    );
  });

  it("não perde os centavos — `R$ 29,80` fala os 80 centavos", () => {
    expect(valorFalado("12 parcelas de R$ 29,80")).toBe("12 parcelas de 29 reais e 80 centavos");
  });

  it("usa o singular em `R$ 1` e o plural em `R$ 197,00`", () => {
    expect(valorFalado("R$ 1")).toBe("1 real");
    expect(valorFalado("R$ 197,00")).toBe("197 reais");
  });

  it("`12x` vira `12 vezes` e `50%` vira `50 por cento`", () => {
    expect(valorFalado("em 12x no cartão com 50% de desconto")).toBe(
      "em 12 vezes no cartão com 50 por cento de desconto",
    );
  });

  it("é idempotente: o texto já falado não vira `reais reais`", () => {
    const falado = valorFalado("você paga 397 reais");
    expect(valorFalado(falado)).toBe("você paga 397 reais");
  });
});

describe("corpoParaVoz — a fala inteira de oferta", () => {
  const OFERTA =
    "hoje você vai pagar R$ 297 — 50% de desconto mais o frete grátis, e pode parcelar no cartão em 12 parcelas de R$ 29,80. E o tratamento ideal, que antes custava R$ 985, hoje você paga somente R$ 397 mais o frete grátis para todo o Brasil, e pode parcelar em 12 parcelas de R$ 39,80.";

  it("nenhum `R$` sobrevive até a voz", () => {
    expect(corpoParaVoz(OFERTA)).not.toContain("R$");
  });

  it("todos os valores da oferta saem por extenso, na ordem", () => {
    const t = corpoParaVoz(OFERTA);
    for (const v of ["297 reais", "29 reais e 80 centavos", "985 reais", "397 reais", "39 reais e 80 centavos"]) {
      expect(t).toContain(v);
    }
  });
});
