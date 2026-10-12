/**
 * O DESPACHANTE — um contrato só, dois provedores atrás.
 *
 * O que se prova aqui é (1) que `configDaVoz` continua sendo o último degrau do
 * ambiente, com a mesma semântica de "vazio = desligado" (regressão zero para
 * quem já fala por env) e (2) que o despacho escolhe o adaptador certo e recusa
 * provedor desconhecido sem lançar.
 */
import { describe, expect, it, vi } from "vitest";

import { configDaVoz, sintetizarVoz, temAdaptadorDeVoz } from "./index";
import { FORMATO_PADRAO, duracaoDoAudio, MODELO_PADRAO, VOZ_PADRAO } from "./tipos";
import { IDS_DE_PROVEDOR_DE_VOZ } from "@/lib/ai/pontos/provedores";

const LOG = { warn: vi.fn() };
const UM_SEGUNDO = new Uint8Array(16_000);

function resposta(bytes: Uint8Array) {
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer, text: async () => "" };
}

describe("configDaVoz — vazio é DESLIGADO, e é o padrão do produto", () => {
  it("sem chave não há voz: instalação self-host não é obrigada a contratar TTS", () => {
    expect(configDaVoz({})).toBeNull();
    expect(configDaVoz({ ELEVENLABS_API_KEY: "   " })).toBeNull();
  });

  it("com chave, o resto vem do default do produto", () => {
    expect(configDaVoz({ ELEVENLABS_API_KEY: " sk_x " })).toEqual({
      chave: "sk_x",
      voz: VOZ_PADRAO,
      modelo: MODELO_PADRAO,
      formato: FORMATO_PADRAO,
      baseUrl: null,
    });
  });

  it("voz e modelo escolhidos na instalação vencem o default", () => {
    expect(
      configDaVoz({
        ELEVENLABS_API_KEY: "sk_x",
        ELEVENLABS_VOICE_ID: "minha-voz",
        ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      }),
    ).toMatchObject({ voz: "minha-voz", modelo: "eleven_multilingual_v2" });
  });
});

describe("duracaoDoAudio — a régua do tempo certo", () => {
  it("formato CBR: bytes ÷ taxa é a duração", () => {
    expect(duracaoDoAudio(16_000)).toBe(1_000);
    expect(duracaoDoAudio(8_000)).toBe(500);
    expect(duracaoDoAudio(0)).toBe(0);
    expect(duracaoDoAudio(Number.NaN)).toBe(0);
  });
});

describe("temAdaptadorDeVoz × a lista que a tela oferece", () => {
  it("só os dois adaptadores que existem", () => {
    expect(temAdaptadorDeVoz("elevenlabs")).toBe(true);
    expect(temAdaptadorDeVoz("tts-aberto")).toBe(true);
    expect(temAdaptadorDeVoz("fish")).toBe(true);
    expect(temAdaptadorDeVoz("openai")).toBe(false);
    expect(temAdaptadorDeVoz("")).toBe(false);
  });

  it("as duas listas são a MESMA — provedor oferecido sem adaptador é botão que não fala", () => {
    // A tela oferece `PROVEDORES_DE_VOZ`; este módulo executa `PROVEDORES_CONHECIDOS`.
    // Divergir para um lado vira botão que não fala; para o outro, código morto.
    for (const id of IDS_DE_PROVEDOR_DE_VOZ) {
      expect(temAdaptadorDeVoz(id), id).toBe(true);
    }
  });
});

describe("sintetizarVoz — despacho", () => {
  it("provedor desconhecido recusa sem tocar a rede", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarVoz("oi", {
      provedor: "voz-magica" as never,
      config: { chave: "x", voz: "v", modelo: "m", formato: FORMATO_PADRAO },
      fetchImpl,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "provedor_desconhecido" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ausente = nativo: quem chamava sem provedor continua falando pela ElevenLabs", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO));
    const r = await sintetizarVoz("oi", {
      config: { chave: "sk", voz: "v", modelo: MODELO_PADRAO, formato: FORMATO_PADRAO },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r.ok).toBe(true);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("api.elevenlabs.io");
  });

  it("tts-aberto vai para o gateway, com o endereço da config", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO));
    const r = await sintetizarVoz("oi", {
      provedor: "tts-aberto",
      config: {
        chave: "sk-gw",
        voz: "voz",
        modelo: "tts-1",
        formato: FORMATO_PADRAO,
        baseUrl: "https://gw.example/v1",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r.ok).toBe(true);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://gw.example/v1/audio/speech");
  });
});