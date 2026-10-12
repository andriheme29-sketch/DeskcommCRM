/**
 * O ADAPTADOR FISH AUDIO — o terceiro provedor de voz, nativo da Fish.
 *
 * A doutrina do módulo (nada lança, duração medida) está em `./tipos`. Aqui só
 * mora o que é DESTE provedor: o endereço, o cabeçalho `Authorization: Bearer`,
 * o corpo `{ text, reference_id, format, ... }` que ele espera, e a leitura da
 * taxa de amostra que a credencial pode trazer.
 *
 * ═══ POR QUE ESTE NÃO É "tts-aberto" ═══
 *
 * A Fish NÃO fala o `/audio/speech` da OpenAI. O corpo é outro (`text` +
 * `reference_id`, não `input` + `voice`), o caminho é `/v1/tts` (não
 * `/audio/speech`) e a autenticação é `Bearer`. Encaixá-la em `tts-aberto`
 * exigiria um proxy no meio; um adaptador próprio é mais honesto e deixa a
 * escolha da voz (`reference_id`) explicável na tela.
 *
 * ═══ A RÉGUA DA DURAÇÃO (e por que ela depende do sample_rate) ═══
 *
 * `duracaoDoAudio` conta bytes de um CBR e assume 128 kbps — a régua da
 * ElevenLabs. A Fish devolve MP3 cuja taxa NÃO é 128 kbps, então a duração
 * sairia errada e a pausa antes do envio (o "tempo certo" da nota de voz)
 * ficaria torta. A credencial pode declarar o `sample_rate` (a doc usa 44.100),
 * e a config o carrega aqui para a conta de duração usá-lo. O `format` que
 * pedimos é constante nomeada — trocar por VBR invalida a conta.
 *
 * ═══ AS OPÇÕES DA DOC QUE **NÃO** ENTRARAM ═══
 *
 * `latency`, `temperature` e `prosody` NÃO vão no corpo: nesta instalação a
 * operação escolheu a simplicidade (decisão do Will, 2026-10-12) — o adaptador
 * usa o endereço modelo/`format` e o `reference_id` da voz aprovada. Se um dia
 * forem necessárias, entram como campos de config, nunca literais soltos.
 *
 * Escrever MP3 já É o streaming do provedor; o turno consome os bytes inteiros
 * para medir a duração e enviar a nota. Não há aqui um caminho de chunks.
 *
 * ═══ POR QUE ESTE ADAPTADOR TEM TIMEOUT PRÓPRIO, MAIOR QUE O PADRÃO ═══
 *
 * Medido nesta instalação (2026-10-12, dentro do container do worker): o tier
 * gratuito leva de 11 s a 22 s para sintetizar UMA fala de etapa do funil
 * (450–1.000 caracteres), e a cauda é errática — a mesma fala que saiu em 0,5 s
 * pelo host já gastou 21 s no worker. Com o `TIMEOUT_PADRAO_MS` (20 s) o áudio
 * era descartado e a mensagem seguia em TEXTO, que é exatamente o defeito que o
 * operador via ("não mandou áudio na etapa de áudio"): o turno pedia voz
 * (`modelo_pediu_voz`) e o log fechava com `tts_falhou / TimeoutError`.
 * O turno já espera a voz antes de enviar, então esperar mais aqui não atrasa
 * nada além do próprio áudio — e falhar custa a nota de voz inteira.
 */
const FISH_TIMEOUT_MS = 90_000;
import {
  duracaoDoAudio,
  TIMEOUT_PADRAO_MS,
  validarPedidoDeVoz,
  type ConfigDaVoz,
  type Log,
  type ResultadoDaSintese,
} from "./tipos";

/** Endereço oficial do provedor, quando a credencial não traz um próprio. */
export const FISH_BASE_URL = "https://api.fish.audio/v1";

/** Modelo de voz da Fish; "s2.1-pro-free" é o do tier gratuito (a doc desta conta). */
export const FISH_MODELO_PADRAO = "s2.1-pro-free";

/** CBR 44,1 kHz — a taxa que a doc da Fish usa, e a base do cálculo de duração. */
export const FISH_SAMPLE_RATE_PADRAO = 44_100;

/**
 * Bits por segundo do MP3 que a Fish devolve, por taxa de amostra. A régua de
 * duração da casa (`duracaoDoAudio`) recebe isto — sem ele a pausa sairia
 * errada. Mapa fechado de propósito: taxa desconhecida cai em 128 kbps.
 */
const BITS_POR_AMOSTRA_FISH: Record<number, number> = {
  44_100: 128_000,
  22_050: 64_000,
  16_000: 48_000,
  8_000: 24_000,
};

export async function sintetizarComFish(
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
  const base = (config.baseUrl ?? "").trim().replace(/\/+$/, "") || FISH_BASE_URL;

  // A voz da Fish é o `reference_id`. Sem ele não há clone a falar.
  const referenceId = (config.voz || "").trim();
  if (referenceId === "") {
    deps.log.warn("voz da Fish sem reference_id configurado");
    return { ok: false, code: "tts_desligado", message: "provedor fish sem reference_id" };
  }

  const sampleRate = FISH_SAMPLE_RATE_PADRAO;

  try {
    const res = await deps.fetchImpl(`${base}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.chave}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        // A Fish aceita o modelo por cabeçalho ou no corpo; usamos o cabeçalho,
        // que é a forma que a doc da conta mostra.
        model: config.modelo || FISH_MODELO_PADRAO,
      },
      body: JSON.stringify({
        text: corpo,
        reference_id: referenceId,
        format: "mp3",
        sample_rate: sampleRate,
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? FISH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detalhe = (await res.text().catch(() => "")).slice(0, 200);
      deps.log.warn("síntese de voz recusada pelo provedor", { http: res.status, detalhe });
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
        duracaoMs: duracaoDoAudio(bytes.length, BITS_POR_AMOSTRA_FISH[sampleRate] ?? 128_000),
      },
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.name : "erro_desconhecido";
    deps.log.warn("síntese de voz falhou", { motivo });
    return { ok: false, code: "tts_falhou", message: motivo };
  }
}
