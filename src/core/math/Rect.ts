import type { Vec2Like } from './Vec2';

/** Plain serializable rectangle. */
export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned rectangle with min corner `(x, y)` and size. */
export class Rect implements RectLike {
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}

  static from(r: RectLike): Rect {
    return new Rect(r.x, r.y, r.width, r.height);
  }

  /** Rect from center and size. */
  static fromCenter(cx: number, cy: number, w: number, h: number): Rect {
    return new Rect(cx - w / 2, cy - h / 2, w, h);
  }

  static fromMinMax(minX: number, minY: number, maxX: number, maxY: number): Rect {
    return new Rect(minX, minY, maxX - minX, maxY - minY);
  }

  set(x: number, y: number, width: number, height: number): this {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    return this;
  }

  copy(r: RectLike): this {
    return this.set(r.x, r.y, r.width, r.height);
  }

  clone(): Rect {
    return new Rect(this.x, this.y, this.width, this.height);
  }

  get left(): number { return this.x; }
  get right(): number { return this.x + this.width; }
  get bottom(): number { return this.y; }
  get top(): number { return this.y + this.height; }
  get centerX(): number { return this.x + this.width / 2; }
  get centerY(): number { return this.y + this.height / 2; }

  contains(p: Vec2Like): boolean {
    return p.x >= this.x && p.x <= this.x + this.width && p.y >= this.y && p.y <= this.y + this.height;
  }

  intersects(r: RectLike): boolean {
    return (
      this.x < r.x + r.width && this.x + this.width > r.x && this.y < r.y + r.height && this.y + this.height > r.y
    );
  }

  /** Grow to include `r`. */
  union(r: RectLike): this {
    const minX = Math.min(this.x, r.x);
    const minY = Math.min(this.y, r.y);
    const maxX = Math.max(this.x + this.width, r.x + r.width);
    const maxY = Math.max(this.y + this.height, r.y + r.height);
    return this.set(minX, minY, maxX - minX, maxY - minY);
  }

  /** Expand by `amount` on all sides. */
  inflate(amount: number): this {
    this.x -= amount;
    this.y -= amount;
    this.width += amount * 2;
    this.height += amount * 2;
    return this;
  }

  toJSON(): RectLike {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }
}
