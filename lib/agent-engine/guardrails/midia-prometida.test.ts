/**
 * O `midiaPrometidaGate` — barra a mensagem que ANUNCIA mídia sem entregá-la.
 *
 * ⚠️ A frase do bloco "MEDIDO EM PRODUÇÃO" é LITERAL: é a nota de voz que o cliente
 * `+55279991...0526` (Wellington) recebeu às 17:43 de 13/10 — "vou te mandar abaixo os
 * últimos depoimentos dos nossos pacientes" — sem vídeo nenhum depois.
 */
import { describe, expect, it } from "vitest";

import { detectarMidiaPrometida, renderVetoDeMidiaPrometida } from "./midia-prometida";

const WELLINGTON =
  "E existem dois tipos de esteatose hepática: a alcoólica e a gordurosa, causada principalmente pela má alimentação. Inclusive vou te mandar abaixo os últimos depoimentos dos nossos pacientes que iniciaram o tratamento nos últimos 30 dias, e eu faço acompanhamento uma vez por semana com cada um. Veja os resultados com bastante atenção.";

describe("MEDIDO EM PRODUÇÃO — a promessa que saiu sem entrega", () => {
  it("a nota de voz do Wellington: depoimentos prometidos, vídeo nunca enviado", () => {
    const a = detectarMidiaPrometida(WELLINGTON);
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("video");
  });

  it("'vou te mandar o guia alimentar' — o mesmo defeito com o PDF", () => {
    const a = detectarMidiaPrometida("Perfeito! Vou te mandar o guia alimentar agora mesmo.");
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("documento");
  });

  it("'segue abaixo o vídeo dos resultados'", () => {
    expect(detectarMidiaPrometida("Segue abaixo o vídeo com os resultados. Assiste com atenção.").achou).toBe(true);
  });

  it("'veja aqui as fotos do produto'", () => {
    expect(detectarMidiaPrometida("Veja aqui as fotos do produto que eu te falei.").achou).toBe(true);
  });

  it("'te mando a prova social dos pacientes'", () => {
    expect(detectarMidiaPrometida("Já te mando a prova social de quem tratou comigo.").achou).toBe(true);
  });

  it("'vou te enviar o PDF do plano alimentar'", () => {
    expect(detectarMidiaPrometida("Vou te enviar o PDF do plano alimentar, tá bom?").achou).toBe(true);
  });

  it("'olha o antes e depois abaixo'", () => {
    expect(detectarMidiaPrometida("Olha o antes e depois abaixo, é impressionante.").achou).toBe(true);
  });
});

describe("VENDA LEGÍTIMA — o que NÃO pode ser barrado", () => {
  it("prometer o que NÃO é mídia (explicar, acompanhar)", () => {
    expect(detectarMidiaPrometida("Vou te explicar direitinho como funciona o tratamento.").achou).toBe(false);
    expect(detectarMidiaPrometida("Vou te acompanhar uma vez por semana durante o tratamento.").achou).toBe(false);
  });

  it("o guia que vem JUNTO DO PRODUTO, depois da compra — não é promessa de envio agora", () => {
    expect(
      detectarMidiaPrometida("Você vai receber o guia alimentar junto com o produto na sua casa.").achou,
    ).toBe(false);
  });

  it("falar de mídia que JÁ foi enviada", () => {
    expect(detectarMidiaPrometida("Como te mandei no vídeo acima, os resultados aparecem na terceira semana.").achou).toBe(false);
  });

  it("o roteiro da esteatose que só CITA a doença, sem prometer anexo", () => {
    expect(
      detectarMidiaPrometida(
        "Existem dois tipos de esteatose hepática: a alcoólica e a gordurosa, causada pela má alimentação.",
      ).achou,
    ).toBe(false);
  });

  it("promessa que não cruza a fronteira da frase", () => {
    expect(
      detectarMidiaPrometida("Vou pensar no seu caso. O vídeo de depoimentos é bem legal.").achou,
    ).toBe(false);
  });

  it("a pergunta sobre a foto do exame, sem promessa de envio", () => {
    expect(detectarMidiaPrometida("Você tem a foto do exame aí? Pode me mandar.").achou).toBe(false);
  });

  it("texto vazio", () => {
    expect(detectarMidiaPrometida("").achou).toBe(false);
    expect(detectarMidiaPrometida("  \n ").achou).toBe(false);
  });

  it("falar do preço do tratamento completo", () => {
    expect(
      detectarMidiaPrometida("São três frascos por R$ 397,00, o tratamento completo de três meses.").achou,
    ).toBe(false);
  });
});

describe("o veto ENSINA o código da mídia (senão o modelo não tem como cumprir)", () => {
  it("para o vídeo, nomeia `depoimento` e `logistica`", () => {
    const t = renderVetoDeMidiaPrometida(["video"]);
    expect(t).toMatch(/depoimento/);
    expect(t).toMatch(/logistica/);
  });

  it("para o documento, nomeia `plano-alimentar`", () => {
    expect(renderVetoDeMidiaPrometida(["documento"])).toMatch(/plano-alimentar/);
  });

  it("para a foto, nomeia `produto_codigo`", () => {
    expect(renderVetoDeMidiaPrometida(["foto"])).toMatch(/produto_codigo/);
  });

  it("avisa que áudio e mídia não vão na mesma chamada", () => {
    expect(renderVetoDeMidiaPrometida(["video"])).toMatch(/NÃO vão na mesma chamada/);
  });

  it("e oferece a saída honesta: reescrever sem prometer", () => {
    expect(renderVetoDeMidiaPrometida(["video"])).toMatch(/SEM prometer/);
  });
});