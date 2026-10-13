/**
 * AS REGRAS DO DOCUMENTO DO CATÁLOGO — o material que o funil promete entregar
 * (o "guia alimentar" da Etapa 8).
 *
 * Molde de `videos.ts` (0613): o banco guarda CAMINHOS num bucket de catálogo e
 * o agente COPIA para a pasta da conversa na hora do envio. A diferença é o
 * tipo: aqui é PDF, não mp4 — e o WhatsApp trata documento como `sendFile`.
 *
 * ⚠️ Por que documento tem regra própria em vez de caber em "vídeo": o
 * `videoPertenceAOrganizacao` exige a forma `<uuid>.mp4` e o `mimeDoVideo`
 * afirma `video/mp4` sempre. Um PDF passando por lá sairia com mime errado (ou
 * recusado), e o cliente receberia um anexo que não abre.
 */

export const BUCKET_DOS_DOCUMENTOS = "catalog-docs";

/** 50 MB: o mesmo teto do bucket de vídeo, que é o limite prático do WhatsApp. */
export const TAMANHO_MAXIMO_DO_DOCUMENTO = 50 * 1024 * 1024;

const FORMA_DO_ARQUIVO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

/**
 * O caminho É desta organização, na forma exata que a rota gera?
 *
 * Mesma cautela do vídeo: quem LÊ confere. A linha de `catalog_media` é gravável
 * pelo PostgREST, então um caminho de outra organização gravado nela viraria
 * documento alheio assinado na tela ou enviado pelo agente.
 */
export function documentoPertenceAOrganizacao(caminho: string, orgId: string): boolean {
  const prefixo = `${orgId}/`;
  return caminho.startsWith(prefixo) && FORMA_DO_ARQUIVO.test(caminho.slice(prefixo.length));
}

export function mimeDoDocumento(caminho: string): "application/pdf" {
  return caminho.endsWith(".pdf") ? "application/pdf" : "application/pdf";
}

/** O nome que o cliente vê no anexo — o `filename` do envio. */
export function nomeDoDocumento(caminho: string, nomeAmigavel?: string | null): string {
  if (nomeAmigavel && nomeAmigavel.trim() !== "") {
    return nomeAmigavel.trim().endsWith(".pdf") ? nomeAmigavel.trim() : `${nomeAmigavel.trim()}.pdf`;
  }
  return caminho.split("/").pop() ?? "documento.pdf";
}