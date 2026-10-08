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
  corpoVaiBemEmVoz,
  decidirModalidadeDeVoz,
  ehModoDeVoz,
  MODOS_DE_VOZ,
  type EntradaDaVoz,
} from "./voz-do-turno";

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

describe("modo sempre — fala, salvo o que a voz estraga", () => {
  it("fala texto comum sem nenhum sinal", () => {
    expect(decidirModalidadeDeVoz(entrada({ modo: "sempre" }))).toEqual({
      falar: true,
      motivo: "modo_sempre",
    });
  });

  it("rebaixa para texto quando o corpo tem link", () => {
    expect(
      decidirModalidadeDeVoz(
        entrada({ modo: "sempre", corpo: "Segue o link: https://loja.example/pedido/9" }),
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

describe("corpoVaiBemEmVoz — o que a voz estraga", () => {
  it("rebaixa link, e-mail, código longo e lista", () => {
    expect(corpoVaiBemEmVoz("veja em https://x.example")).toBe("texto_tem_link");
    expect(corpoVaiBemEmVoz("manda pra mim@empresa.com")).toBe("texto_tem_email");
    expect(corpoVaiBemEmVoz("seu pedido é 12345678")).toBe("texto_tem_codigo");
    expect(corpoVaiBemEmVoz("a\nb\nc")).toBe("texto_em_lista");
    expect(corpoVaiBemEmVoz("")).toBe("texto_vazio");
    expect(corpoVaiBemEmVoz("a".repeat(2_501))).toBe("texto_longo");
  });

  it("NÃO rebaixa o que vai bem falado — preço curto, resposta seca, pergunta", () => {
    for (const texto of [
      "Oi! Como posso ajudar?",
      "Custa R$ 1.500,00 à vista.",
      "Sim, temos em estoque.",
      "Posso te ligar às 14h, pode ser?",
    ]) {
      expect(corpoVaiBemEmVoz(texto), texto).toBeNull();
    }
  });
});