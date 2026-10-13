/**
 * O DOCUMENTO VAI JUNTO — o agente entrega o PDF que o funil promete
 * ("seu guia alimentar já está pronto", Etapa 8), pelo código do catálogo.
 *
 * Molde de `videos-do-catalogo.ts`: o caminho do envio é o que o handler JÁ sabe
 * mandar (`media_storage_path` em `whatsapp-media/<org>/<conversa>/...`), com URL
 * assinada, nunca base64. Para chegar lá o arquivo é COPIADO de `catalog-docs`
 * para a pasta da conversa — é a cópia que a conversa possui, a inbox mostra e a
 * LGPD apaga junto. O destino é determinístico (`material-<codigo>.pdf`).
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE: o funil do fabricante promete um material ao
 * cliente e o CRM não tinha por onde entregá-lo — o agente PROMETIA e não
 * cumpria (medido: um lead com as tags `guia-pronto-aguardando-valores` e
 * `guia-alimentar-pendente-coleta` e guia nenhum). Prometer e não entregar é o
 * que mais queima a confiança de quem já está quase comprando.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { BUCKET_DOS_DOCUMENTOS, mimeDoDocumento, nomeDoDocumento, documentoPertenceAOrganizacao } from "@/lib/catalogo/docs";
import type { Queryable } from "../queue/queue";

const BUCKET_DA_CONVERSA = "whatsapp-media";

export interface DocumentoParaEnvio {
  /** caminho em `whatsapp-media`, dentro da pasta da conversa */
  storagePath: string;
  mime: string;
  /** o nome que o cliente lê no anexo */
  filename: string;
}

interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** Copia do catálogo para a conversa. `true` = o arquivo está no destino. */
export type CopiarDocumento = (origem: string, destino: string) => Promise<boolean>;

export function copiarDocumentoNoStorage(log: Log): CopiarDocumento {
  return async (origem, destino) => {
    const { error } = await createAdminClient()
      .storage.from(BUCKET_DOS_DOCUMENTOS)
      .copy(origem, destino, { destinationBucket: BUCKET_DA_CONVERSA });
    if (!error) return true;
    // Já copiado antes para esta conversa: o arquivo que precisamos está lá.
    if (/already exists/i.test(error.message) || (error as { statusCode?: string }).statusCode === "409") {
      return true;
    }
    log.warn("documento do catálogo não copiado para a conversa", { detalhe: error.message.slice(0, 120) });
    return false;
  };
}

export type DocumentoPreparado =
  | { ok: true; documento: DocumentoParaEnvio | null }
  | { ok: false; code: "documento_nao_encontrado"; message: string };

/**
 * Acha o material pelo código e deixa o arquivo pronto na pasta da conversa.
 *
 * Código sem material cadastrado é erro de ENSINO (o modelo corrige o código),
 * mas o arquivo que não COPIA não derruba o envio: devolve `documento: null` e o
 * texto segue — a operação nunca fica sem resposta por causa de uma mídia.
 */
export async function prepararDocumentoDoCatalogo(
  db: Queryable,
  copiar: CopiarDocumento,
  input: { tenantId: string; conversationId: string; codigo: string },
): Promise<DocumentoPreparado> {
  const { rows } = await db.query<{ storage_path: string; nome: string | null }>(
    "select storage_path, nome from catalog_media where organization_id = $1 and codigo = $2 and tipo = 'documento'",
    [input.tenantId, input.codigo.trim()],
  );
  const linha = rows[0];
  if (!linha) {
    return {
      ok: false,
      code: "documento_nao_encontrado",
      message:
        `não há material com o código ${JSON.stringify(input.codigo)} no catálogo. Use um ` +
        "`documento_codigo` válido do roteiro, ou envie sem documento_codigo.",
    };
  }
  // Só caminho que é DESTA organização: a linha é gravável pelo PostgREST e a
  // cópia é por service role — sem o filtro sairia material de outra organização.
  if (!documentoPertenceAOrganizacao(linha.storage_path, input.tenantId)) {
    return {
      ok: false,
      code: "documento_nao_encontrado",
      message: `o material ${JSON.stringify(input.codigo)} está indisponível no momento.`,
    };
  }
  const destino = `${input.tenantId}/${input.conversationId}/material-${input.codigo.trim()}.pdf`;
  if (!(await copiar(linha.storage_path, destino))) return { ok: true, documento: null };
  return {
    ok: true,
    documento: {
      storagePath: destino,
      mime: mimeDoDocumento(linha.storage_path),
      filename: nomeDoDocumento(linha.storage_path, linha.nome),
    },
  };
}