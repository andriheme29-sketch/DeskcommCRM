/**
 * O ADAPTADOR ABERTO — qualquer gateway que fale o `/audio/speech` da OpenAI.
 *
 * É o caminho de quem roteia a própria voz: 9Router, LiteLLM, um proxy
 * corporativo, o próprio endpoint de áudio da OpenAI. O contrato é o mesmo para
 * todos e é por isso que este adapter serve a qualquer compatível — e é o que o
 * dono pediu: "qualquer endpoint compatível, universal".
 *
 * ═══ O QUE ELE PEDE, E POR QUE ═══
 *
 * `POST {base}/audio/speech` com `{ model, input, voice, response_format }`. O
 * `response_format` é `mp3` porque a régua de duração (`duracaoDoAudio`) conta
 * bytes de um CBR — pedir `opus`/`pcm` devolveria um arquivo cuja duração este
 * código não sabe medir, e a pausa antes do envio sairia errada. O CBR 44,1 kHz
 * do mp3 é a mesma régua do adapter nativo, de propósito: a duração não pode
 * depender de qual provedor a empresa escolheu.
 *
 * O corpo cru do erro e a exceção de rede NUNCA sobem — ver `./tipos`.
 */
import {
  duracaoDoAudio,
  TIMEOUT_PADRAO_MS,
  validarPedidoDeVoz,
  type ConfigDaVoz,
  type Log,
  type ResultadoDaSintese,
} from "./tipos";

/** Endereço oficial, quando a credencial não traz um próprio. */
export const OPENAI_TTS_BASE_URL = "https://api.openai.com/v1";

/** Modelo de voz padrão do protocolo OpenAI, quando a credencial não escolhe outro. */
export const MODELO_PADRAO_ABERTO = "tts-1";

/** A voz padrão do protocolo OpenAI (existe em qualquer compatível). */
export const VOZ_PADRAO_ABERTA = "alloy";

export async function sintetizarComOpenAi(
  texto: string,
  deps: {
    config: ConfigDaVoz | null;
    fetchImpl: typeof fetch;
    log: Log;
    timeoutMs?: number;
  },
): Promise<ResultadoDaSintese> {
  const ruim = validarPedidoDeVoz(texto, deps.config);
  if (ruim !== null) return ruim;
  const config = deps.config as ConfigDaVoz;
  const corpo = texto.trim();
  const base = (config.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (base === "") {
    // Sem endereço não há como falar com um gateway. Recusa explicada, não
    // exceção: quem escolheu o provedor aberto ESCOLHEU dar-lhe um endereço.
    deps.log.warn("voz por endpoint aberto sem endereço configurado");
    return { ok: false, code: "tts_desligado", message: "provedor de voz aberto sem baseUrl" };
  }

  try {
    const res = await deps.fetchImpl(`${base}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.chave}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        model: config.modelo || MODELO_PADRAO_ABERTO,
        input: corpo,
        voice: config.voz || VOZ_PADRAO_ABERTA,
        // CBR: é dele que sai a duração (ver cabeçalho). Não trocar por VBR.
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_PADRAO_MS),
    });

    if (!res.ok) {
      const detalhe = (await res.text().catch(() => "")).slice(0, 200);
      deps.log.warn("síntese de voz recusada pelo gateway", { http: res.status, detalhe });
      return { ok: false, code: "tts_falhou", message: `http_${res.status}` };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      deps.log.warn("síntese de voz devolveu corpo vazio");
      return { ok: false, code: "tts_falhou", message: "corpo_vazio" };
    }

    return {
      ok: true,
      voz: {
        bytes,
        mime: "audio/mpeg",
        duracaoMs: duracaoDoAudio(bytes.length),
      },
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.name : "erro_desconhecido";
    deps.log.warn("síntese de voz falhou", { motivo });
    return { ok: false, code: "tts_falhou", message: motivo };
  }
}