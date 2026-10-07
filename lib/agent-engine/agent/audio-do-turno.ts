/**
 * O ÁUDIO DO TURNO — irmão de `fotos-do-produto.ts`, e pelo mesmo motivo.
 *
 * ═══ POR QUE O MESMO MOLDE DA FOTO ═══
 *
 * A doutrina de mídia desta casa é Storage-first: o arquivo sobe para
 * `whatsapp-media/<org>/<conversa>/`, e o que viaja até o canal é uma URL
 * assinada de vida curta (`app/api/v1/messages/_handler.ts`). A voz não pode
 * ser a exceção — e não é: este módulo só faz a metade que falta, que é
 * GARANTIR que exista um arquivo na pasta da conversa antes do envio. Quem
 * assina e quem envia continua sendo o handler, o mesmo caminho da foto.
 *
 * ═══ NADA AQUI DERRUBA O ENVIO ═══
 *
 * Sintetizar é rede e crédito de terceiro: chave revogada, cota estourada,
 * provedor fora do ar, Storage recusando. Cada um desses desfechos volta como
 * `{ ok: false }` com o motivo curto, e quem chama manda o TEXTO — a regra é
 * "degrada para o piso, nunca perde a resposta", idêntica à foto que não copia.
 * Áudio é upgrade do atendimento; a venda não depende dele.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { extFromMime } from '@/lib/messaging/media/types';

import type { CodigoDeFalhaDaVoz, ResultadoDaSintese } from '@/lib/tts/elevenlabs';

/** Bucket privado das conversas — o mesmo das fotos e do PDF de proposta. */
const BUCKET_DA_CONVERSA = 'whatsapp-media';

export interface AudioParaEnvio {
  /** caminho em `whatsapp-media`, dentro da pasta da conversa */
  storagePath: string;
  mime: string;
  /** duração do arquivo: é ela que governa a pausa e o "gravando áudio…" */
  duracaoMs: number;
}

/** Sobe os bytes para a conversa. `true` = o arquivo está lá. */
export type SubirAudio = (destino: string, bytes: Buffer, mime: string) => Promise<boolean>;

interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export type AudioDoTurno =
  | { ok: true; audio: AudioParaEnvio }
  | { ok: false; code: CodigoDeFalhaDaVoz | 'audio_nao_subiu'; message: string };

/** O caminho canônico da conversa, o mesmo que a mídia inbound usa. */
export function caminhoDoAudio(
  tenantId: string,
  conversationId: string,
  quandoMs: number,
  mime: string,
): string {
  return `${tenantId}/${conversationId}/voz-${quandoMs}.${extFromMime(mime)}`;
}

/**
 * Implementação real do upload, para injetar no turno. Separa o efeito de rede
 * da orquestração — é o que deixa `prepararAudioDoTurno` testável sem Storage.
 */
export function subirAudioNoStorage(log: Log): SubirAudio {
  return async (destino, bytes, mime) => {
    const { error } = await createAdminClient()
      .storage.from(BUCKET_DA_CONVERSA)
      .upload(destino, bytes, { contentType: mime, upsert: true });
    if (!error) return true;
    // O motivo é curto e não carrega o texto do cliente — o path já o identifica.
    log.warn('áudio do turno não subiu para a conversa', {
      detalhe: error.message.slice(0, 120),
    });
    return false;
  };
}

/**
 * Sintetiza `texto` e deixa o arquivo pronto na pasta da conversa.
 *
 * A ordem é deliberada: primeiro a voz, depois o Storage. Subir bytes que não
 * existem seria trabalho perdido, e o caminho do arquivo só pode ser montado
 * depois de saber o mime — que é a resposta do provedor, não uma constante
 * nossa (trocar o formato troca a extensão).
 */
export async function prepararAudioDoTurno(
  sintetizar: (texto: string) => Promise<ResultadoDaSintese>,
  subir: SubirAudio,
  input: {
    tenantId: string;
    conversationId: string;
    texto: string;
    /** injetável para o teste; em produção é o relógio */
    agoraMs?: number;
  },
): Promise<AudioDoTurno> {
  const sintese = await sintetizar(input.texto);
  if (!sintese.ok) return sintese;

  const destino = caminhoDoAudio(
    input.tenantId,
    input.conversationId,
    input.agoraMs ?? Date.now(),
    sintese.voz.mime,
  );
  const subiu = await subir(destino, sintese.voz.bytes, sintese.voz.mime);
  if (!subiu) {
    return { ok: false, code: 'audio_nao_subiu', message: 'storage recusou o arquivo de voz' };
  }

  return {
    ok: true,
    audio: { storagePath: destino, mime: sintese.voz.mime, duracaoMs: sintese.voz.duracaoMs },
  };
}

/**
 * A pausa antes de um áudio: a duração DELE, mais o jitter anti-ban que toda
 * bolha paga. Não é `calcularAtrasoHumano` — lá a régua é "quanto se digita",
 * e ninguém digita um áudio. Devolve ms prontos para o `sleep`.
 */
export function esperaDoAudio(duracaoMs: number, jitter: () => number): number {
  const duracao = Number.isFinite(duracaoMs) && duracaoMs > 0 ? duracaoMs : 0;
  return duracao + jitter();
}
