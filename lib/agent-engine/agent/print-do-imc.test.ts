import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { calcularImc, renderImcPng, svgDoImc } from './print-do-imc';

describe('calcularImc', () => {
  it('bordas das faixas', () => {
    // 18.4 < 18.5 → abaixo do peso
    expect(calcularImc(47.1, 160).imc).toBe(18.4);
    expect(calcularImc(47.1, 160).faixa).toBe('abaixo do peso');
    // 18.5 já é peso normal (teto EXCLUSIVO)
    expect(calcularImc(47.4, 160).faixa).toBe('peso normal');
    expect(calcularImc(63.7, 160).faixa).toBe('peso normal'); // 24.9
    expect(calcularImc(64, 160).faixa).toBe('sobrepeso'); // 25.0
    expect(calcularImc(76.5, 160).faixa).toBe('sobrepeso'); // 29.9
    expect(calcularImc(76.8, 160).faixa).toBe('obesidade grau I'); // 30.0
    expect(calcularImc(102.4, 160).faixa).toBe('obesidade grau III'); // 40.0 (>=40)
  });

  it('arredonda a 1 casa', () => {
    expect(calcularImc(70, 175).imc).toBe(22.9);
    expect(calcularImc(80, 180).imc).toBe(24.7);
  });
});

describe('renderImcPng', () => {
  it('devolve PNG', async () => {
    const png = await renderImcPng(70, 175);
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  // Guarda contra a regressão do "IMC em branco": o SVG define o texto com
  // `font-family: sans-serif`. Numa imagem SEM fonte instalada, o click de
  // layout do resvg não desenha NADA de texto e o PNG sai só com a barra verde —
  // foi exatamente o defeito medido no container (0 pixels escuros de texto).
  // Aqui o teste falha se o render não tiver tinta de texto visível.
  it('desenha o texto do IMC (não sai em branco)', () => {
    const pm = new Resvg(svgDoImc(88, 172), { fitTo: { mode: 'width', value: 600 } })
      .render();
    const px = pm.pixels;
    let pixelsEscuros = 0;
    for (let i = 0; i < px.length; i += 4) {
      // Texto é #111827/#374151/#6b7280 — cinza-chumbo. Conta só tinta escura.
      if (px[i + 3]! > 0 && px[i]! < 130 && px[i + 1]! < 130 && px[i + 2]! < 130) {
        pixelsEscuros += 1;
      }
    }
    // Uma única linha de texto de 34px rende milhares de pixels. O piso de 200
    // já distingue "texto desenhado" de "imagem em branco" com folga.
    expect(pixelsEscuros).toBeGreaterThan(200);
  });
});