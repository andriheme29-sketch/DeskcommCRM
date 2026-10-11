/**
 * AS MÍDIAS DE VÍDEO DO CATÁLOGO — as regras que a rota, a tela e o agente
 * compartilham (migration 0613).
 *
 * O banco guarda CAMINHOS em `catalog-video`; a leitura é por service role, que
 * não tem RLS. Quem LÊ confere que o caminho é DESTA organização — um `manager`
 * escreve a linha pelo PostgREST e poderia gravar o caminho de outra org.
 *
 * Molde de `lib/catalogo/fotos.ts` (0390), adaptado: aqui não há ordem nem teto
 * de quantidade por produto — a identidade é o PAPEL no funil (`codigo`), e cada
 * papel tem UM arquivo.
 */

export const BUCKET_DOS_VIDEOS = "catalog-video";

/** 50 MB: o `file_size_limit` do bucket — teto de vídeo do WhatsApp/WAHA. */
export const TAMANHO_MAXIMO_DO_VIDEO = 50 * 1024 * 1024;

const FORMA_DO_ARQUIVO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/;

/**
 * O caminho É desta organização, na forma exata que a rota gera?
 *
 * ⚠️ Quem LÊ confere, não só quem escreve — sem isto, um caminho de outra
 * organização gravado na linha viraria vídeo alheio assinado na tela ou enviado
 * pelo agente (ou, na remoção, arquivo alheio APAGADO pela rota).
 */
export function videoPertenceAOrganizacao(caminho: string, orgId: string): boolean {
  const prefixo = `${orgId}/`;
  return caminho.startsWith(prefixo) && FORMA_DO_ARQUIVO.test(caminho.slice(prefixo.length));
}

export function mimeDoVideo(caminho: string): "video/mp4" {
  return caminho.endsWith(".mp4") ? "video/mp4" : "video/mp4";
}
