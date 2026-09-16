import { clamp01 } from './scalar';

/** Plain serializable color; channels are 0..1 floats. */
export interface ColorLike {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** RGBA color with float channels in `[0, 1]`. */
export class Color implements ColorLike {
  constructor(public r = 1, public g = 1, public b = 1, public a = 1) {}

  static readonly WHITE: Readonly<Color> = Object.freeze(new Color(1, 1, 1, 1));
  static readonly BLACK: Readonly<Color> = Object.freeze(new Color(0, 0, 0, 1));
  static readonly TRANSPARENT: Readonly<Color> = Object.freeze(new Color(0, 0, 0, 0));
  static readonly RED: Readonly<Color> = Object.freeze(new Color(1, 0, 0, 1));
  static readonly GREEN: Readonly<Color> = Object.freeze(new Color(0, 1, 0, 1));
  static readonly BLUE: Readonly<Color> = Object.freeze(new Color(0, 0, 1, 1));

  static from(c: ColorLike): Color {
    return new Color(c.r, c.g, c.b, c.a);
  }

  /** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or `rgb(a)(...)`. */
  static fromHex(hex: string): Color {
    return new Color().setHex(hex);
  }

  /** From a 0xRRGGBB integer. */
  static fromInt(rgb: number, a = 1): Color {
    return new Color(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, a);
  }

  /** From HSL (h in degrees, s/l in 0..1). */
  static fromHSL(h: number, s: number, l: number, a = 1): Color {
    return new Color().setHSL(h, s, l, a);
  }

  set(r: number, g: number, b: number, a = 1): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  copy(c: ColorLike): this {
    return this.set(c.r, c.g, c.b, c.a);
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b, this.a);
  }

  setHex(hex: string): this {
    const s = hex.trim();
    if (s.startsWith('#')) {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h, 16);
      if (h.length === 6) return this.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
      if (h.length === 8)
        return this.set(((n >>> 24) & 255) / 255, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    }
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) {
      const parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
      return this.set(parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length > 3 ? parts[3] : 1);
    }
    return this;
  }

  setHSL(h: number, s: number, l: number, a = 1): this {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return this.set(r + m, g + m, b + m, a);
  }

  lerp(c: ColorLike, t: number): this {
    this.r += (c.r - this.r) * t;
    this.g += (c.g - this.g) * t;
    this.b += (c.b - this.b) * t;
    this.a += (c.a - this.a) * t;
    return this;
  }

  multiply(c: ColorLike): this {
    this.r *= c.r;
    this.g *= c.g;
    this.b *= c.b;
    this.a *= c.a;
    return this;
  }

  scale(s: number): this {
    this.r *= s;
    this.g *= s;
    this.b *= s;
    return this;
  }

  /** 0xRRGGBB integer. */
  toInt(): number {
    return ((clamp01(this.r) * 255) << 16) | ((clamp01(this.g) * 255) << 8) | (clamp01(this.b) * 255);
  }

  /** `#rrggbb` (or `#rrggbbaa` when alpha < 1). */
  toHex(withAlpha = this.a < 1): string {
    const h = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
    return `#${h(this.r)}${h(this.g)}${h(this.b)}${withAlpha ? h(this.a) : ''}`;
  }

  /** CSS `rgba(...)` string for Canvas2D. */
  toCSS(): string {
    return `rgba(${Math.round(clamp01(this.r) * 255)},${Math.round(clamp01(this.g) * 255)},${Math.round(
      clamp01(this.b) * 255,
    )},${clamp01(this.a)})`;
  }

  toArray(): [number, number, number, number] {
    return [this.r, this.g, this.b, this.a];
  }

  toJSON(): ColorLike {
    return { r: this.r, g: this.g, b: this.b, a: this.a };
  }

  equals(c: ColorLike, eps = 1e-4): boolean {
    return (
      Math.abs(this.r - c.r) <= eps &&
      Math.abs(this.g - c.g) <= eps &&
      Math.abs(this.b - c.b) <= eps &&
      Math.abs(this.a - c.a) <= eps
    );
  }
}
