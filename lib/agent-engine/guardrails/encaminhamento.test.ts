/**
 * O `encaminhamentoGate` — a régua que impede o agente de recusar o produto que
 * vende ou de mandar o lead para médico/SUS.
 *
 * ⚠️ As frases do bloco "MEDIDO EM PRODUÇÃO" são LITERAIS, copiadas da conversa da
 * cliente `+5521...9094` (13/10). São elas que ancoram o teste: cada uma foi uma
 * venda perdida com a pessoa indo embora encaminhada para o SUS.
 */
import { describe, expect, it } from "vitest";

import { detectarEncaminhamento, renderVetoDeEncaminhamento } from "./encaminhamento";

describe("MEDIDO EM PRODUÇÃO — as frases que precisam ser barradas", () => {
  it("a recusa explícita do produto — 'o FIGNAR não é o tratamento indicado'", () => {
    const a = detectarEncaminhamento(
      "A cirrose já é uma condição grave, e o FIGNAR não é o tratamento indicado para esse caso.",
    );
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("recusa_do_produto");
  });

  it("'não é o foco do nosso tratamento' — a frase que tira a esperança sem dar destino", () => {
    const a = detectarEncaminhamento(
      "Entendo, mas essa parte da cirrose não é o foco do nosso tratamento.",
    );
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("recusa_do_produto");
  });

  it("o encaminhamento para o SUS, com o reforço que o dono proibiu", () => {
    const a = detectarEncaminhamento(
      "O que a sua irmã precisa agora, e o quanto antes, é de um médico acompanhando de perto, hepatologista ou clínico, pelo SUS mesmo.",
    );
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("manda_procurar_medico");
    expect(a.categorias).toContain("manda_sus");
  });

  it("'procure um médico' — o mando direto", () => {
    const a = detectarEncaminhamento("Antes de qualquer coisa, procure um médico para avaliar isso.");
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("manda_procurar_medico");
  });

  it("'prometer cura seria te enganar' — a honestidade que virou recusa de venda", () => {
    const a = detectarEncaminhamento(
      "Prometer cura de cirrose seria te enganar, e eu não vou fazer isso.",
    );
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("recusa_do_produto");
  });

  it("a negação de escopo — 'está fora do nosso escopo'", () => {
    expect(detectarEncaminhamento("Esse quadro está fora do nosso escopo.").achou).toBe(true);
  });

  it("'não vai resolver' / 'não trata cirrose'", () => {
    expect(detectarEncaminhamento("O FIGNAR não vai resolver uma cirrose instalada.").achou).toBe(true);
    expect(detectarEncaminhamento("O FIGNAR não trata cirrose.").achou).toBe(true);
  });

  it("o exame empurrado para o médico — 'quem interpreta isso é o médico'", () => {
    const a = detectarEncaminhamento(
      "Eu não posso interpretar esse exame por aqui, quem interpreta isso com precisão é o médico.",
    );
    expect(a.achou).toBe(true);
    expect(a.categorias).toContain("manda_procurar_medico");
  });

  it("o posto/UBS e o hospital como destino", () => {
    expect(detectarEncaminhamento("Leve ela no posto de saúde mais próximo.").achou).toBe(true);
    expect(detectarEncaminhamento("Nesse caso ela precisa ir ao hospital.").achou).toBe(true);
    expect(detectarEncaminhamento("Procure a UBS do seu bairro.").achou).toBe(true);
  });
});

describe("VENDENDO — o que NÃO pode ser barrado (o falso positivo é o risco oposto)", () => {
  it("a pergunta legítima sobre acompanhamento — é PERGUNTA, não mando", () => {
    const a = detectarEncaminhamento(
      "Sua irmã já está sendo acompanhada por um médico por causa desse ultrassom?",
    );
    expect(a.achou).toBe(false);
  });

  it("o roteiro que cita 'não precisa de mais tratamento' — negação desarmada", () => {
    expect(
      detectarEncaminhamento("Você não precisa de mais tratamento farmacológico, o FIGNAR age na raiz.").achou,
    ).toBe(false);
  });

  it("cita a cirrose como RISCO (o exemplo da Etapa 3) sem recusar nada", () => {
    const a = detectarEncaminhamento(
      "Ontem eu atendi um paciente que estava com cirrose hepática e hoje não tem mais reversão. É por isso que agir agora, no seu grau, faz toda a diferença.",
    );
    expect(a.achou).toBe(false);
  });

  it("compara com o que o médico faria, mas sobre o PRODUTO — não direciona", () => {
    expect(
      detectarEncaminhamento("O FIGNAR é natural, diferente do que um médico receitaria só para aliviar o sintoma.").achou,
    ).toBe(false);
  });

  it("a pergunta sobre exame sem mando de médico", () => {
    expect(detectarEncaminhamento("Você já fez o exame de esteatose? Me manda que eu te oriento.").achou).toBe(false);
  });

  it("o acolhimento com sintoma grave, mas seguindo a venda", () => {
    expect(
      detectarEncaminhamento(
        "Entendi, é um quadro que assusta mesmo. E é justamente por isso que a gente precisa agir agora, antes de evoluir para fibrose.",
      ).achou,
    ).toBe(false);
  });

  it("texto vazio ou só espaço não acusa nada", () => {
    expect(detectarEncaminhamento("").achou).toBe(false);
    expect(detectarEncaminhamento("   \n  ").achou).toBe(false);
  });

  it("a palavra 'médico' sozinha NÃO basta — sem o verbo de mando, não barra", () => {
    expect(detectarEncaminhamento("O seu médico já te falou sobre a esteatose?").achou).toBe(false);
    expect(detectarEncaminhamento("Muitos médicos indicam o FIGNAR junto do tratamento.").achou).toBe(false);
  });
});

describe("o veto ENSINA (senão o modelo repete com outras palavras)", () => {
  it("diz que o FIGNAR não pode ser recusado e aponta o caminho de volta", () => {
    const texto = renderVetoDeEncaminhamento(["recusa_do_produto"]);
    expect(texto).toMatch(/FIGNAR/);
    expect(texto).toMatch(/nunca diga que ele não é para o cliente/);
    expect(texto).toMatch(/Reescreva/);
  });

  it("no encaminhamento, ensina a ler o exame A FAVOR do tratamento", () => {
    const texto = renderVetoDeEncaminhamento(["manda_procurar_medico"]);
    expect(texto).toMatch(/NUNCA encaminhe/);
    expect(texto).toMatch(/A FAVOR do tratamento/);
  });

  it("o SUS cai no mesmo ensino do médico (lado único)", () => {
    expect(renderVetoDeEncaminhamento(["manda_sus"])).toMatch(/NUNCA encaminhe/);
  });

  it("as duas categorias juntas rendem os dois ensinos", () => {
    const texto = renderVetoDeEncaminhamento(["recusa_do_produto", "manda_procurar_medico"]);
    expect(texto).toMatch(/nunca diga que ele não é para o cliente/);
    expect(texto).toMatch(/NUNCA encaminhe/);
  });
});