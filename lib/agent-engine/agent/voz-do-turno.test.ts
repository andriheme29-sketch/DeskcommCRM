/**
 * A MATRIZ DE DECISÃO DA VOZ — o coração desta entrega.
 *
 * O que se prova aqui não é "o áudio saiu": é que a TELA tem a palavra final,
 * que o pedido do modelo não manda sozinho, e que o texto que a voz estragaria
 * (link, código, lista) sai em texto mesmo no modo `sempre`. Cada caso é um
 * defeito que alguém já veria no cliente.
 */
import { describe, expect, it } from "vitest";

import {
  clientePedeVoz,
  corpoParaVoz,
  corpoVaiBemEmVoz,
  decidirModalidadeDeVoz,
  ehModoDeVoz,
  FALA_CURTA_MAX_CHARS,
  MODOS_DE_VOZ,
  type EntradaDaVoz,
} from "./voz-do-turno";

/**
 * Uma fala LONGA de verdade (a Etapa 2 do roteiro, 294 chars) — o caso que o modo
 * `sempre` existe para atender. Antes desta constante, os casos de `sempre`
 * usavam "Oi, tudo bem?" (13 chars), que a régua de fala curta agora escreve.
 */
const FALA_LONGA =
  "Certo, entendi sim todos os seus sintomas. E eu fico um pouco preocupado, porque essa doença é uma doença silenciosa, ela não produz sintomas, é assintomática. Quando a pessoa começa a sentir esses sintomas, é porque já está em um processo de evolução e vai rapidamente para o grau 3!";

/** Base neutra: sem sinal nenhum, texto simples. Cada caso sobrescreve o que importa. */
function entrada(over: Partial<EntradaDaVoz> = {}): EntradaDaVoz {
  return {
    modo: "decidir",
    pedidoDoModelo: false,
    clienteMandouAudio: false,
    textoDoCliente: null,
    corpo: "Oi, tudo bem?",
    ...over,
  };
}

describe("ehModoDeVoz", () => {
  it("só os quatro modos que a tela oferece", () => {
    expect(MODOS_DE_VOZ).toHaveLength(4);
    for (const m of MODOS_DE_VOZ) expect(ehModoDeVoz(m)).toBe(true);
    expect(ehModoDeVoz("as_vezes")).toBe(false);
    expect(ehModoDeVoz("")).toBe(false);
  });
});

describe("modo null — o estado de antes da tela, que NÃO pode mudar", () => {
  it("o modelo manda, e SEM lint: preserva a saída exata de quem já publicou com voz", () => {
    expect(decidirModalidadeDeVoz(entrada({ modo: null, pedidoDoModelo: true }))).toEqual({
      falar: true,
      motivo: "modo_padrao",
    });
    // Um link em voz alta é ruim, mas é o que o agente JÁ FAZIA — ligar o lint
    // aqui mudaria o que está publicado sem ninguém ter pedido.
    expect(
      decidirModalidadeDeVoz(
        entrada({ modo: null, pedidoDoModelo: true, corpo: "veja https://x.example" }),
      ),
    ).toEqual({ falar: true, motivo: "modo_padrao" });
  });

  it("sem pedido do modelo, texto — igual a hoje", () => {
    expect(decidirModalidadeDeVoz(entrada({ modo: null }))).toEqual({
      falar: false,
      motivo: "modo_padrao",
    });
  });
});

describe("modo nunca — a tela é autoridade, inclusive contra o modelo", () => {
  it("recusa mesmo com o modelo pedindo e o cliente tendo mandado áudio", () => {
    expect(
      decidirModalidadeDeVoz(
        entrada({ modo: "nunca", pedidoDoModelo: true, clienteMandouAudio: true }),
      ),
    ).toEqual({ falar: false, motivo: "modo_nunca" });
  });
});

describe("modo sempre — fala o LONGO, escreve o curto, e só isso", () => {
  it("fala a fala longa do funil sem nenhum sinal", () => {
    expect(decidirModalidadeDeVoz(entrada({ modo: "sempre", corpo: FALA_LONGA }))).toEqual({
      falar: true,
      motivo: "modo_sempre",
    });
  });

  it("ESCREVE a pergunta curta — a voz não acrescenta nada a 40 caracteres", () => {
    // Medi\u00e7\u00e3o no roteiro: as perguntas de [TEXTO] t\u00eam 37-97 caracteres.
    for (const curta of [
      "Entendi, qual é o seu peso e sua altura?",
      "Você faz o uso de bebidas alcoólicas?",
      "Há quanto tempo você vem sentindo esses sintomas?",
    ]) {
      expect(decidirModalidadeDeVoz(entrada({ modo: "sempre", corpo: curta })), curta).toEqual({
        falar: false,
        motivo: "texto_curto",
      });
    }
  });

  it("MAS o pedido do modelo vence a régua: quem pediu, pediu", () => {
    expect(
      decidirModalidadeDeVoz(
        entrada({ modo: "sempre", pedidoDoModelo: true, corpo: "Qual é o seu peso e sua altura?" }),
      ),
    ).toEqual({ falar: true, motivo: "modo_sempre" });
  });

  it("rebaixa para texto quando o corpo tem link, mesmo com o modelo pedindo", () => {
    // Link vence QUALQUER pedido: não há o que ouvir num endereço.
    expect(
      decidirModalidadeDeVoz(
        entrada({
          modo: "sempre",
          pedidoDoModelo: true,
          corpo: "Segue o link: https://loja.example/pedido/9 — " + FALA_LONGA,
        }),
      ),
    ).toEqual({ falar: false, motivo: "texto_tem_link" });
  });
});

describe("modo quando_cliente_fala — simetria de canal, e só ela", () => {
  it("fala quando o cliente mandou áudio", () => {
    expect(
      decidirModalidadeDeVoz(entrada({ modo: "quando_cliente_fala", clienteMandouAudio: true })),
    ).toEqual({ falar: true, motivo: "cliente_mandou_audio" });
  });

  it("NÃO fala por pedido do modelo — quem não mandou áudio não recebe áudio", () => {
    expect(
      decidirModalidadeDeVoz(
        entrada({ modo: "quando_cliente_fala", pedidoDoModelo: true, clienteMandouAudio: false }),
      ),
    ).toEqual({ falar: false, motivo: "modo_exige_audio_do_cliente" });
  });
});

describe("modo decidir — qualquer sinal liga, e o silêncio é mudo", () => {
  it("cliente mandou áudio", () => {
    expect(decidirModalidadeDeVoz(entrada({ clienteMandouAudio: true }))).toEqual({
      falar: true,
      motivo: "cliente_mandou_audio",
    });
  });

  it("cliente pediu voz por texto", () => {
    expect(decidirModalidadeDeVoz(entrada({ textoDoCliente: "pode me mandar áudio?" }))).toEqual({
      falar: true,
      motivo: "cliente_pediu_voz",
    });
  });

  it("o modelo pedia voz (compatibilidade com o prompt atual)", () => {
    // Corpo LONGO: em `decidir` quem pede voz é atendido, mas a régua de fala
    // curta continua escrevendo a pergunta de 30 caracteres (ver o bloco dela).
    expect(decidirModalidadeDeVoz(entrada({ pedidoDoModelo: true, corpo: FALA_LONGA }))).toEqual({
      falar: true,
      motivo: "modelo_pediu_voz",
    });
  });

  it("o modelo pedindo voz em fala CURTA: fala, porque o pedido vence a régua", () => {
    expect(decidirModalidadeDeVoz(entrada({ pedidoDoModelo: true }))).toEqual({
      falar: true,
      motivo: "modelo_pediu_voz",
    });
  });

  it("sem sinal nenhum, texto — e o motivo diz por quê", () => {
    expect(decidirModalidadeDeVoz(entrada())).toEqual({
      falar: false,
      motivo: "sem_sinal_de_voz",
    });
  });
});

describe("corpoParaVoz — o que a voz NÃO deve falar", () => {
  it("tira o emoji: a síntese lia o '😅' em voz alta no meio do funil", () => {
    expect(corpoParaVoz("Essa doença evolui rápido e vira cirrose 😅")).toBe(
      "Essa doença evolui rápido e vira cirrose",
    );
    expect(corpoParaVoz("Oi! Tudo bem? 😁✅")).toBe("Oi! Tudo bem?");
    expect(corpoParaVoz("Me conta por aqui, por favor 🙏")).toBe("Me conta por aqui, por favor");
  });

  it("tira o riso ESCRITO — 'kkkk' falado vira gargalhada sintetizada", () => {
    expect(corpoParaVoz("combinado kkkk sem problema")).toBe("combinado sem problema");
    expect(corpoParaVoz("hahaha que engraçado")).toBe("que engraçado");
    expect(corpoParaVoz("rsrs tudo certo")).toBe("tudo certo");
  });

  it("PRESERVA o que carrega sentido falado: preço e texto normal", () => {
    // O cifrão e o preço precisam sobreviver: é o que o cliente ouve.
    const comPreco = "Hoje você paga R$ 297,00 no tratamento de 90 dias.";
    expect(corpoParaVoz(comPreco)).toBe(comPreco);
    const simples = "Entendi, qual é o seu peso e sua altura?";
    expect(corpoParaVoz(simples)).toBe(simples);
  });

  it("não deixa pontuação órfã nem espaço duplo do emoji removido", () => {
    expect(corpoParaVoz("Ficou alguma dúvida? 😊 Posso te passar os valores!")).toBe(
      "Ficou alguma dúvida? Posso te passar os valores!",
    );
    expect(corpoParaVoz("Certo 😁")).toBe("Certo");
    expect(corpoParaVoz("")).toBe("");
  });
});

describe("clientePedeVoz — conservador de propósito", () => {
  it("casa o pedido direto, com e sem acento, em pt e es", () => {
    for (const frase of [
      "pode me mandar audio?",
      "me manda áudio por favor",
      "prefiro ouvir, pode ser áudio?",
      "não consigo ler, me manda áudio",
      "estou dirigindo, me manda áudio",
      "mándame audio para escuchar",
    ]) {
      expect(clientePedeVoz(frase), frase).toBe(true);
    }
  });

  it("quem NÃO PODE LER recebe voz mesmo na fala curta — o pedido vence a régua", () => {
    // O gatilho que mais existe no canal: o cliente que não consegue ler.
    expect(
      decidirModalidadeDeVoz(
        entrada({ modo: "decidir", textoDoCliente: "não consigo ler, me manda áudio", corpo: "Qual é o seu peso?" }),
      ),
    ).toEqual({ falar: true, motivo: "cliente_pediu_voz" });
  });

  it("NÃO casa conversa comum — o falso positivo aqui gasta crédito", () => {
    for (const frase of [
      "bom dia",
      "qual o preço do produto?",
      "vocês entregam em São Paulo?",
      "quero saber sobre a garantia",
      "obrigado!",
      "",
      null,
    ]) {
      expect(clientePedeVoz(frase), String(frase)).toBe(false);
    }
  });
});

describe("corpoVaiBemEmVoz — o que a voz estraga, e o que ela não acrescenta", () => {
  it("rebaixa link, e-mail, código longo e lista", () => {
    expect(corpoVaiBemEmVoz("veja em https://x.example")).toBe("texto_tem_link");
    expect(corpoVaiBemEmVoz("manda pra mim@empresa.com")).toBe("texto_tem_email");
    expect(corpoVaiBemEmVoz("seu pedido é 12345678")).toBe("texto_tem_codigo");
    expect(corpoVaiBemEmVoz("a\nb\nc")).toBe("texto_em_lista");
    expect(corpoVaiBemEmVoz("")).toBe("texto_vazio");
    expect(corpoVaiBemEmVoz("a".repeat(2_501))).toBe("texto_longo");
  });

  it("ESCREVE a fala curta: abaixo do limiar a voz não acrescenta nada", () => {
    for (const curta of [
      "Oi! Como posso ajudar?",
      "Custa R$ 1.500,00 à vista.",
      "Sim, temos em estoque.",
      "Posso te ligar às 14h, pode ser?",
    ]) {
      expect(corpoVaiBemEmVoz(curta), curta).toBe("texto_curto");
    }
  });

  it("fala o que é longo: acima do limiar vai bem em voz", () => {
    expect(corpoVaiBemEmVoz("a".repeat(FALA_CURTA_MAX_CHARS))).toBeNull();
    expect(corpoVaiBemEmVoz("a".repeat(FALA_CURTA_MAX_CHARS + 1))).toBeNull();
  });

  it("a régua vem DEPOIS dos vetos: fala curta COM link continua texto_tem_link", () => {
    // Se o tamanho viesse primeiro, uma fala curta com link escaparia como
    // `texto_curto` e um dia alguém "corrigiria" o lint para voz.
    expect(corpoVaiBemEmVoz("veja https://x.example")).toBe("texto_tem_link");
    expect(corpoVaiBemEmVoz("manda pra mim@empresa.com")).toBe("texto_tem_email");
  });

  it("a medição do roteiro: nenhuma fala de [TEXTO] passa, toda [ÁUDIO] passa", () => {
    // As 7 falas [TEXTO] medidas no prompt (37-97 chars) e a menor [ÁUDIO] (149).
    for (const t of [
      "Há quanto tempo você vem sentindo esses sintomas?",
      "Entendi, qual é o seu peso e sua altura?",
      "Você faz o uso de bebidas alcoólicas?",
    ]) {
      expect(corpoVaiBemEmVoz(t), t).not.toBeNull();
    }
    const menorAudio =
      "Se você já ouviu os áudios que eu te enviei aqui acima, explicando a causa dessa doença, me informa há quanto tempo você vem sentindo esses sintomas.";
    expect(menorAudio.length).toBeGreaterThanOrEqual(149);
    expect(corpoVaiBemEmVoz(menorAudio)).toBeNull();
  });
});