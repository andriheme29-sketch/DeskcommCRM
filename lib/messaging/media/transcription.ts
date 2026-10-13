/**
 * Transcrição de áudio plugável (Onda 3). Default: API speech-to-text
 * OpenAI-compatível (Whisper) via BYOK. O derivado é texto → alimenta QUALQUER
 * modelo de chat (camada universal). Um backend mlx-whisper local implementa a
 * mesma interface para self-host em Apple Silicon (fora deste MVP).
 */
import type { TokenUsage } from "@/lib/agent-engine/edge/llm/pricing";

export interface TranscriptionProvider {
  transcribe(audio: Buffer, mime: string): Promise<string>;
  /**
   * Só quem é cobrado por TOKEN implementa: o modelo de conversa da
   * organização (degrau 3 da escada, `escada-de-transcricao.ts`). Sem o uso
   * devolvido, a linha em `llm_calls` sairia sem tokens e com custo nulo —
   * uma chamada de LLM paga, com preço na tabela, contada como "preço
   * desconhecido" e fora do teto de gasto.
   */
  transcribeMedindo?(audio: Buffer, mime: string): Promise<{ texto: string; uso: TokenUsage }>;
}

/**
 * Os degraus da escada que chamam `/v1/audio/transcriptions` (abaixo). Esse
 * serviço tem tabela de preço própria, que o sistema não conhece, e a chamada
 * não lê tokens de volta: a linha deles em `llm_calls` tem custo nulo por
 * construção, e é por esta lista — gravada em `origem_da_escolha` — que o
 * aviso de "preço desconhecido" os separa do degrau 3, que é LLM cobrado por
 * token (`lib/ai/budget/check.ts`).
 */
export const ORIGENS_DA_TRANSCRICAO_POR_SERVICO = ["servico_da_instalacao", "padrao_openai_compativel"] as const;

export interface TranscriptionCreds {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /**
   * Idiomas esperados no áudio (ISO-639-1). Vazio = o serviço detecta sozinho,
   * que é o comportamento de sempre.
   *
   * Existe porque a detecção sozinha ALUCINA em áudio curto, com ruído ou com
   * sotaque regional. Medido numa loja em espanhol (26/09/2026, 14 áudios
   * reais de clientes): `whisper-1` sem idioma devolveu "Thanks for
   * watching!" para um áudio sem fala, uma frase em GREGO para "mejor dejamos
   * ahí nomás" (o cliente cancelando) e "ya es claro" para "ya es caro" — e o
   * agente respondeu ao que leu. Com o idioma declarado, `gpt-transcribe`
   * acertou os três e devolveu vazio para o áudio sem fala.
   */
  languages?: readonly string[];
}

const DEFAULT_BASE = "https://api.openai.com";
const DEFAULT_MODEL = "whisper-1";

/**
 * O modelo que transcreve de verdade: o de `TRANSCRIPTION_MODEL` quando a
 * instalação o define, senão `whisper-1`. Uma função só para o worker (que
 * transcreve) e a tela de Provedores (que ANUNCIA o modelo) — duas leituras
 * separadas fariam a tela dizer `whisper-1` com outro modelo em uso.
 *
 * Com `TRANSCRIPTION_BASE_URL` preenchido e sem `TRANSCRIPTION_API_KEY`, o
 * modelo do `.env` foi escrito para OUTRO serviço (o exemplo do `.env.example`
 * é `whisper-large-v3`, do Groq), e a chamada vai à OpenAI com a chave da
 * organização: pedir esse modelo lá quebraria no update uma transcrição que
 * funciona com `whisper-1`. Nesse caso vale `whisper-1`, como antes.
 */
export function modeloDeTranscricaoEmVigor(doAmbiente: {
  model: string | undefined;
  apiKey: string | undefined;
  baseUrl: string | undefined;
}): string {
  const m = (doAmbiente.model ?? "").trim();
  const modeloDeOutroServico = (doAmbiente.baseUrl ?? "").trim() !== "" && (doAmbiente.apiKey ?? "").trim() === "";
  return m === "" || modeloDeOutroServico ? DEFAULT_MODEL : m;
}

/**
 * `TRANSCRIPTION_LANGUAGES` ("es" ou "pt,es") → lista de códigos. Tolerante de
 * propósito: é variável opcional de `.env`, e grafia errada não pode derrubar
 * o worker — o código que não tem forma de ISO-639 fica de fora e o resto vale.
 */
export function idiomasDaTranscricao(bruto: string | undefined): string[] {
  return (bruto ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[a-z]{2,3}$/.test(x));
}

/**
 * Como o idioma vai no corpo, conforme o modelo. Os modelos novos da OpenAI
 * (`gpt-transcribe`, `gpt-live-transcribe`) recebem a LISTA `languages[]`; os
 * anteriores (`whisper-1`, `gpt-4o-*-transcribe`, os Whisper de terceiros)
 * recebem UM `language`. Mandar os dois é recusado pela API.
 */
export function camposDeIdioma(model: string, languages: readonly string[]): [string, string][] {
  if (languages.length === 0) return [];
  return /^gpt-(live-)?transcribe\b/.test(model)
    ? languages.map((l): [string, string] => ["languages[]", l])
    : [["language", languages[0]!]];
}

function extFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  if (base.includes("webm")) return "webm";
  if (base.includes("wav")) return "wav";
  return "bin";
}

/** Endereço do Speech-to-Text do ElevenLabs (Scribe) — protocolo próprio. */
export const ELEVENLABS_STT_BASE_URL = "https://api.elevenlabs.io/v1";

/** Modelo de transcrição do ElevenLabs; `scribe_v1` é o que a conta serve. */
export const ELEVENLABS_STT_MODEL = "scribe_v1";

/**
 * O Speech-to-Text do ElevenLabs — protocolo PRÓPRIO, não o da OpenAI.
 *
 * O caminho é `/v1/speech-to-text`, a chave vai no cabeçalho `xi-api-key` (não
 * em `Authorization: Bearer`) e o modelo é o campo `model_id`. Encaixá-lo no
 * `apiTranscriptionProvider` daria 404 em todo áudio — por isso o ramo é
 * separado, escolhido pelo endereço configurado (`transcriberDaInstalacao`).
 *
 * É cobrado por crédito do serviço (não por token), então NÃO implementa
 * `transcribeMedindo`: a linha em `llm_calls` sai com custo nulo e origem
 * `servico_da_instalacao`, o mesmo tratamento dos outros serviços de
 * transcrição (ver `ORIGENS_DA_TRANSCRICAO_POR_SERVICO`).
 */
export function elevenLabsTranscriptionProvider(
  creds: TranscriptionCreds,
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider {
  const base = (creds.baseUrl || ELEVENLABS_STT_BASE_URL).trim().replace(/\/+$/, "");
  const model = creds.model || ELEVENLABS_STT_MODEL;
  // POOL, não uma chave só: a cota do Scribe é POR CHAVE, e a operação tem o
  // pool do TTS (dez chaves). Aceita lista separada por vírgula em
  // `TRANSCRIPTION_API_KEY` e RODIZIA entre elas, começando de onde a última
  // parou — assim o consumo se espalha e nenhuma esgota antes das outras.
  // Sem isto, uma chave só queima e a transcrição para de novo (o sintoma que o
  // operador via era "o agente não escuta o áudio do cliente").
  const chaves = (chaveDoPool(creds) ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k !== "");
  if (chaves.length === 0) {
    return { transcribe: async () => "" };
  }
  let proxima = 0;

  return {
    async transcribe(audio, mime) {
      const inicio = proxima;
      let ultimoErro: string | null = null;
      for (let i = 0; i < chaves.length; i++) {
        const idx = (inicio + i) % chaves.length;
        // O FormData não se reaproveita entre tentativas: o corpo é consumido.
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(audio)], { type: mime.split(";")[0]!.trim() }),
          `audio.${extFor(mime)}`,
        );
        form.append("model_id", model);
        const idioma = (creds.languages ?? [])[0];
        if (idioma) form.append("language_code", idioma);

        const cabecalho = new Headers();
        cabecalho.set("xi-api-key", chaves[idx]!);
        const res = await fetchImpl(`${base}/speech-to-text`, {
          method: "POST",
          headers: cabecalho,
          body: form,
        });
        if (res.ok) {
          proxima = (idx + 1) % chaves.length;
          const json = (await res.json()) as { text?: string };
          return json.text ?? "";
        }
        ultimoErro = `transcription_${res.status}`;
        // 401/402/429 são da CHAVE (cota/limite) — vale tentar a próxima.
        // Qualquer outro status é do pedido, e insistir só gastaria as boas.
        if (res.status !== 401 && res.status !== 402 && res.status !== 429) break;
      }
      throw new Error(ultimoErro ?? "transcription_sem_chave");
    },
  };
}

/**
 * Lê a chave (ou o pool) do campo de credencial. Existe como função por um
 * motivo prático: a expressão inline era reescrita por mascaramento de segredo
 * ao gravar este arquivo, o que quebrou a sintaxe uma vez. Aqui a leitura fica
 * em um lugar só.
 */
function chaveDoPool(creds: TranscriptionCreds): string | undefined {
  return creds["apiKey"];
}

export function transcriberDaInstalacao(
  creds: TranscriptionCreds,
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider {
  const base = (creds.baseUrl ?? "").toLowerCase();
  // `elevenlabs.io` cobre `api.elevenlabs.io` e qualquer proxy da marca.
  return base.includes("elevenlabs")
    ? elevenLabsTranscriptionProvider(creds, fetchImpl)
    : apiTranscriptionProvider(creds, fetchImpl);
}

export function apiTranscriptionProvider(
  creds: TranscriptionCreds,
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider {
  const rawBase = (creds.baseUrl ?? DEFAULT_BASE).trim().replace(/\/+$/, "");
  const base = rawBase.replace(/\/v1$/, "");
  const model = creds.model ?? DEFAULT_MODEL;
  return {
    async transcribe(audio, mime) {
      const form = new FormData();
      form.append("model", model);
      form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: mime.split(";")[0]!.trim() }),
        `audio.${extFor(mime)}`,
      );
      for (const [campo, valor] of camposDeIdioma(model, creds.languages ?? [])) form.append(campo, valor);
      const res = await fetchImpl(`${base}/v1/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        body: form,
      });
      if (!res.ok) throw new Error(`transcription_${res.status}`);
      const json = (await res.json()) as { text?: string };
      return json.text ?? "";
    },
  };
}
