import { Resvg } from '@resvg/resvg-js';

/** Faixas de IMC da OMS, em ordem, com o teto EXCLUSIVO de cada uma. */
export const FAIXAS_IMC = [
  { max: 18.5, faixa: 'abaixo do peso' },
  { max: 25, faixa: 'peso normal' },
  { max: 30, faixa: 'sobrepeso' },
  { max: 35, faixa: 'obesidade grau I' },
  { max: 40, faixa: 'obesidade grau II' },
  { max: Infinity, faixa: 'obesidade grau III' },
] as const;

export function calcularImc(pesoKg: number, alturaCm: number): { imc: number; faixa: string } {
  const alturaM = alturaCm / 100;
  const imc = Math.round((pesoKg / (alturaM * alturaM)) * 10) / 10;
  const ultima = FAIXAS_IMC[FAIXAS_IMC.length - 1]!;
  const linha = FAIXAS_IMC.find((f) => imc < f.max) ?? ultima;
  return { imc, faixa: linha.faixa };
}

/**
 * Monta o SVG do "print" do IMC. Puro e separado do render para poder ser
 * conferido sem binário.
 */
export function svgDoImc(pesoKg: number, alturaCm: number): string {
  const { imc, faixa } = calcularImc(pesoKg, alturaCm);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#ffffff"/>
  <rect x="0" y="0" width="600" height="12" fill="#16a34a"/>
  <text x="300" y="150" font-family="sans-serif" font-size="34" font-weight="bold"
        fill="#111827" text-anchor="middle">Seu IMC: ${imc}</text>
  <text x="300" y="210" font-family="sans-serif" font-size="26"
        fill="#374151" text-anchor="middle">${faixa}</text>
  <text x="300" y="300" font-family="sans-serif" font-size="18"
        fill="#6b7280" text-anchor="middle">${pesoKg} kg · ${alturaCm} cm</text>
</svg>`;
}

/** Renderiza o print do IMC em PNG. */
export async function renderImcPng(pesoKg: number, alturaCm: number): Promise<Buffer> {
  const resvg = new Resvg(svgDoImc(pesoKg, alturaCm), {
    fitTo: { mode: 'width', value: 600 },
  });
  return Buffer.from(resvg.render().asPng());
}