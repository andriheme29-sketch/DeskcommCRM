/**
 * O VÍDEO VAI JUNTO — o agente manda o vídeo de marca (depoimento, logística)
 * na hora certa do funil (migration 0613).
 *
 * Molde de `fotos-do-produto.ts`: o caminho do envio é o que o handler JÁ sabe
 * mandar (`media_storage_path` em `whatsapp-media/<org>/<conversa>/...`), com URL
 * assinada curta, nunca base64. Para chegar lá, o arquivo é COPIADO de
 * `catalog-video` para a pasta da conversa — é a cópia que a conversa possui, a
 * inbox mostra e a LGPD apaga junto.
 *
 * O destino é determinístico (`marca-<papel>.<ext>`): reenviar o mesmo vídeo na
 * mesma conversa, ou o replay de um job que caiu depois da cópia, reaproveita o
 * arquivo em vez de encher a cota de Storage.
 */
import { BUCKET_DOS_VIDEOS, mimeDoVideo, videoPertenceAOrganizacao } from '@/lib/catalogo/videos';
import { createAdminClient } from '@/lib/supabase/admin';

import type { Queryable } from '../queue/queue';

const BUCKET_DA_CONVERSA = 'whatsapp-media';

export interface VideoParaEnvio {
  /** caminho em `whatsapp-media`, dentro da pasta da conversa */
  storagePath: string;
  mime: string;
}

interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** Copia do catálogo para a conversa. `true` = o arquivo está no destino. */
export type CopiarVideo = (origem: string, destino: string) => Promise<boolean>;

export function copiarVideoNoStorage(log: Log): CopiarVideo {
  return async (origem, destino) => {
    const { error } = await createAdminClient()
      .storage.from(BUCKET_DOS_VIDEOS)
      .copy(origem, destino, { destinationBucket: BUCKET_DA_CONVERSA });
    if (!error) return true;
    // Já copiado antes para esta conversa: o arquivo que precisamos está lá.
    if (/already exists/i.test(error.message) || (error as { statusCode?: string }).statusCode === '409') {
      return true;
    }
    log.warn('vídeo do catálogo não copiado para a conversa', { detalhe: error.message.slice(0, 120) });
    return false;
  };
}

export type VideoPreparado =
  | { ok: true; video: VideoParaEnvio | null }
  | { ok: false; code: 'video_nao_encontrado'; message: string };

/**
 * Acha a mídia pelo código/papel e deixa o arquivo pronto na pasta da conversa.
 *
 * Código sem mídia cadastrada é erro de ENSINO (o modelo corrige o código), mas
 * a mídia que não COPIA não derruba o envio: devolve `video: null` e o texto sai
 * (degradar para só texto) — a operação nunca fica sem resposta por causa de
 * uma mídia.
 */
export async function prepararVideoDoCatalogo(
  db: Queryable,
  copiar: CopiarVideo,
  input: { tenantId: string; conversationId: string; codigo: string },
): Promise<VideoPreparado> {
  const { rows } = await db.query<{ storage_path: string }>(
    "select storage_path from catalog_media where organization_id = $1 and codigo = $2 and tipo = 'video'",
    [input.tenantId, input.codigo.trim()],
  );
  const linha = rows[0];
  if (!linha) {
    return {
      ok: false,
      code: 'video_nao_encontrado',
      message:
        `não há vídeo com o código ${JSON.stringify(input.codigo)} no material. Use um ` +
        '`video_codigo` válido do roteiro, ou envie sem video_codigo.',
    };
  }
  // Só caminho que é DESTA organização: a linha é gravável pelo PostgREST e a
  // cópia é por service role — sem o filtro, sairia vídeo de outra organização.
  if (!videoPertenceAOrganizacao(linha.storage_path, input.tenantId)) {
    return {
      ok: false,
      code: 'video_nao_encontrado',
      message: `o vídeo ${JSON.stringify(input.codigo)} está indisponível no momento.`,
    };
  }
  const ext = linha.storage_path.split('.').pop() ?? 'mp4';
  const destino = `${input.tenantId}/${input.conversationId}/marca-${input.codigo.trim()}.${ext}`;
  if (!(await copiar(linha.storage_path, destino))) return { ok: true, video: null };
  return { ok: true, video: { storagePath: destino, mime: mimeDoVideo(linha.storage_path) } };
}
