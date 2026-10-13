/**
 * A IMAGEM VAI JUNTO — o agente manda a imagem de marca do funil (a composição
 * nutricional, a língua, a caixinha, a tabela de preços) na hora certa.
 *
 * Molde de `videos-do-catalogo.ts`: o caminho do envio é o que o handler JÁ sabe
 * mandar (`media_storage_path` em `whatsapp-media/<org>/<conversa>/...`), com URL
 * assinada curta, nunca base64. Para chegar lá, o arquivo é COPIADO de
 * `catalog-images` para a pasta da conversa — é a cópia que a conversa possui, a
 * inbox mostra e a LGPD apaga junto.
 *
 * O destino é determinístico (`marca-<papel>.<ext>`): reenviar a mesma imagem na
 * mesma conversa, ou o replay de um job que caiu depois da cópia, reaproveita o
 * arquivo em vez de encher a cota de Storage.
 *
 * ⚠️ UMA imagem por papel. O funil oficial trata cada mídia como um item único; a
 * `Precos 1` e a `Precos 2` são papéis SEPARADOS justamente porque saem juntas na
 * mesma etapa, cada uma com a sua legenda.
 */
import { BUCKET_DAS_IMAGENS, imagemPertenceAOrganizacao, mimeDaImagem } from '@/lib/catalogo/imagens';
import { createAdminClient } from '@/lib/supabase/admin';

import type { Queryable } from '../queue/queue';

const BUCKET_DA_CONVERSA = 'whatsapp-media';

export interface ImagemParaEnvio {
  /** caminho em `whatsapp-media`, dentro da pasta da conversa */
  storagePath: string;
  mime: string;
}

interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** Copia do catálogo para a conversa. `true` = o arquivo está no destino. */
export type CopiarImagem = (origem: string, destino: string) => Promise<boolean>;

export function copiarImagemNoStorage(log: Log): CopiarImagem {
  return async (origem, destino) => {
    const { error } = await createAdminClient()
      .storage.from(BUCKET_DAS_IMAGENS)
      .copy(origem, destino, { destinationBucket: BUCKET_DA_CONVERSA });
    if (!error) return true;
    // Já copiada antes para esta conversa: o arquivo que precisamos está lá.
    if (/already exists/i.test(error.message) || (error as { statusCode?: string }).statusCode === '409') {
      return true;
    }
    log.warn('imagem do catálogo não copiada para a conversa', { detalhe: error.message.slice(0, 120) });
    return false;
  };
}

export type ImagemPreparada =
  | { ok: true; imagem: ImagemParaEnvio | null }
  | { ok: false; code: 'imagem_nao_encontrada'; message: string };

/**
 * Acha a imagem pelo código/papel e deixa o arquivo pronto na pasta da conversa.
 *
 * Código sem imagem cadastrada é erro de ENSINO (o modelo corrige o código), mas
 * a imagem que não COPIA não derruba o envio: devolve `imagem: null` e o texto
 * sai (degradar para só texto) — a operação nunca fica sem resposta por causa de
 * uma mídia.
 */
export async function prepararImagemDoCatalogo(
  db: Queryable,
  copiar: CopiarImagem,
  input: { tenantId: string; conversationId: string; codigo: string },
): Promise<ImagemPreparada> {
  const { rows } = await db.query<{ storage_path: string }>(
    "select storage_path from catalog_media where organization_id = $1 and codigo = $2 and tipo = 'imagem'",
    [input.tenantId, input.codigo.trim()],
  );
  const linha = rows[0];
  if (!linha) {
    return {
      ok: false,
      code: 'imagem_nao_encontrada',
      message:
        `não há imagem com o código ${JSON.stringify(input.codigo)} no material. Use um ` +
        '`imagem_codigo` válido do roteiro, ou envie sem imagem_codigo.',
    };
  }
  // Só caminho que é DESTA organização: a linha é gravável pelo PostgREST e a
  // cópia é por service role — sem o filtro, sairia imagem de outra organização.
  if (!imagemPertenceAOrganizacao(linha.storage_path, input.tenantId)) {
    return {
      ok: false,
      code: 'imagem_nao_encontrada',
      message: `a imagem ${JSON.stringify(input.codigo)} está indisponível no momento.`,
    };
  }
  const ext = linha.storage_path.split('.').pop() ?? 'jpg';
  const destino = `${input.tenantId}/${input.conversationId}/marca-${input.codigo.trim()}.${ext}`;
  if (!(await copiar(linha.storage_path, destino))) return { ok: true, imagem: null };
  return { ok: true, imagem: { storagePath: destino, mime: mimeDaImagem(linha.storage_path) } };
}