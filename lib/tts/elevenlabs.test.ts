/**
 * O ADAPTADOR NATIVO: o que ele faz quando dá certo e — o que importa mais — o
 * que ele faz quando dá errado. Nenhum desfecho ruim pode LANÇAR: o turno do
 * agente corre dentro da resposta ao cliente, e uma exceção aqui derrubaria a
 * mensagem inteira. Todo caso ruim volta como `{ ok: false }` e o turno degrada
 * para texto.
 *
 * `configDaVoz` e o despacho ficam em `./index.test.ts` — aqui é só o HTTP do
 * provedor nativo.
 */
import { describe, expect, it, vi } from "vitest";

import { ELEVENLABS_BASE_URL, sintetizarComElevenLabs } from "./elevenlabs";
import { FORMATO_PADRAO, LIMITE_DE_CARACTERES, MODELO_PADRAO } from "./tipos";

const LOG = { warn: vi.fn() };
const CONFIG = { chave: "sk_teste", voz: "voz-1", modelo: MODELO_PADRAO, formato: FORMATO_PADRAO };

/** 1 segundo de mp3 CBR 128 kbps = 16.000 bytes. */
const UM_SEGUNDO = new Uint8Array(16_000);

function resposta(bytes: Uint8Array, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    arrayBuffer: async () => bytes.buffer,
    text: async () => "voice_not_found",
  };
}

describe("sintetizarComElevenLabs — nenhum desfecho lança", () => {
  it("desligada: devolve tts_desligado e nem toca a rede", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarComElevenLabs("oi", { config: null, fetchImpl, log: LOG });
    expect(r).toMatchObject({ ok: false, code: "tts_desligado" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("texto vazio não vira voz", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarComElevenLabs("   ", { config: CONFIG, fetchImpl, log: LOG });
    expect(r).toMatchObject({ ok: false, code: "texto_vazio" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("texto acima do teto é recusado ANTES de gastar crédito", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarComElevenLabs("a".repeat(LIMITE_DE_CARACTERES + 1), {
      config: CONFIG,
      fetchImpl,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "texto_longo" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caminho feliz: POST com a voz, o modelo e a chave no header; devolve bytes e duração", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO));
    const r = await sintetizarComElevenLabs("Oi, tudo bem?", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });

    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error("esperava sucesso");
    expect(r.voz.mime).toBe("audio/mpeg");
    expect(r.voz.duracaoMs).toBe(1_000);
    expect(r.voz.bytes.length).toBe(16_000);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith(ELEVENLABS_BASE_URL)).toBe(true);
    expect(url).toContain("/text-to-speech/voz-1");
    expect(url).toContain(`output_format=${FORMATO_PADRAO}`);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("sk_teste");
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Oi, tudo bem?",
      model_id: MODELO_PADRAO,
    });
  });

  it("endereço próprio vence o oficial — o proxy da ElevenLabs é escolha da empresa", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO));
    await sintetizarComElevenLabs("oi", {
      config: { ...CONFIG, baseUrl: "https://meu-proxy.example/v1/" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url.startsWith("https://meu-proxy.example/v1/text-to-speech/")).toBe(true);
  });

  it("HTTP de erro vira tts_falhou com o status, e o detalhe vai ao log", async () => {
    const log = { warn: vi.fn() };
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO, { ok: false, status: 401 }));
    const r = await sintetizarComElevenLabs("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "http_401" });
    expect(log.warn).toHaveBeenCalled();
  });

  it("corpo vazio não é voz — vira tts_falhou em vez de bolha muda", async () => {
    const fetchImpl = vi.fn(async () => resposta(new Uint8Array(0)));
    const r = await sintetizarComElevenLabs("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "corpo_vazio" });
  });

  it("timeout/DNS/TLS viram tts_falhou — a exceção NUNCA sobe", async () => {
    const erro = new Error("aborted");
    erro.name = "TimeoutError";
    const fetchImpl = vi.fn(async () => {
      throw erro;
    });
    const r = await sintetizarComElevenLabs("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "TimeoutError" });
  });
});