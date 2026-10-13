/**
 * AS IMAGENS DE MARCA DO CATÁLOGO — as mídias do funil que não são produto nem
 * vídeo nem PDF (a composição nutricional, a língua, a caixinha, os preços).
 *
 * Molde de `videos.ts` (0613) e `docs.ts` (0620). A diferença é o mime: aqui são
 * `image/jpeg` ou `image/png`, e o WhatsApp as entrega como FOTO.
 *
 * ⚠️ Por que imagem de marca em vez de foto de produto: MEDIDO em produção, o
 * roteiro pedia `[FOTO: fignar-5]` como "foto da composição/tabela nutricional",
 * e `fignar-5` é o produto de 5 FRASCOS com DUAS fotos — o agente dizia "olha a
 * composição" e mandava duas fotos de frascos. A imagem de marca pertence ao
 * PAPEL no funil, não a um produto; assim o papel tem UM arquivo e o roteiro não
 * improvisa com código de produto.
 */

export const BUCKET_DAS_IMAGENS = "catalog-images";

/** 25 MB — o `file_size_limit` do bucket. A maior imagem do funil tem 1,4 MB. */
export const TAMANHO_MAXIMO_DA_IMAGEM = 25 * 1024 * 1024;

const FORMA_DO_ARQUIVO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$/;

/**
 * O caminho É desta organização, na forma exata que a rota gera?
 *
 * Mesma cautela do vídeo e do documento: quem LÊ confere. A linha de
 * `catalog_media` é gravável pelo PostgREST, então um caminho de outra
 * organização gravado nela viraria imagem alheia assinada na tela ou enviada
 * pelo agente (ou, na remoção, arquivo alheio APAGADO pela rota).
 */
export function imagemPertenceAOrganizacao(caminho: string, orgId: string): boolean {
  const prefixo = `${orgId}/`;
  return caminho.startsWith(prefixo) && FORMA_DO_ARQUIVO.test(caminho.slice(prefixo.length));
}

/**
 * O mime da imagem pelo sufixo. Diferente de vídeo/PDF (mime único), aqui há dois
 * formatos vivos — `image/png` e `image/jpeg` — e o canal precisa do certo para
 * montar o envio.
 *
 * ⚠️ `.webp` cai em `image/jpeg` de propósito: o WAHA converte para JPEG no
 * envio, e afirmar `image/webp` faria o canal entregar um anexo que alguns
 * aparelhos não abrem.
 */
export function mimeDaImagem(caminho: string): "image/png" | "image/jpeg" {
  return /\.png$/i.test(caminho) ? "image/png" : "image/jpeg";
}