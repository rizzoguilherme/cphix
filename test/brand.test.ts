import { describe, it, expect } from "vitest";
import { logoIcon, renderAvatarSvg, renderAvatarPng, PALETTE } from "../src/brand";

describe("logoIcon", () => {
  it("desenha o balão em menta e o check em violeta, na posição e tamanho pedidos", () => {
    const svg = logoIcon(10, 20, 50);
    expect(svg).toContain('translate(10 20) scale(0.5)');
    expect(svg).toContain(PALETTE.mint);
    expect(svg).toContain(PALETTE.violetLogo);
  });
});

describe("avatar do bot", () => {
  it("é um SVG quadrado de 640 com o nome da marca", () => {
    const svg = renderAvatarSvg();
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="640"');
    expect(svg).toContain("CPhix");
  });

  it("vira um PNG de verdade", () => {
    const png = renderAvatarPng();
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeGreaterThan(5000);
  });
});
