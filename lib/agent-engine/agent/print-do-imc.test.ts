import { describe, expect, it } from 'vitest';
import { calcularImc, renderImcPng } from './print-do-imc';

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
});