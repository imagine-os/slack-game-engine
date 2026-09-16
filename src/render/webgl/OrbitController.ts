import { Vec3, clamp } from '../../core/math';
import type { Transform } from '../../core/ecs/Transform';
import type { Input } from '../../input/Input';

/**
 * Orbit camera helper: drag with the left/right mouse button to rotate, wheel
 * to zoom, middle-drag (or shift-drag) to pan. Writes into a camera Transform.
 */
export class OrbitController {
  readonly target = new Vec3(0, 0, 0);
  distance = 10;
  yaw = Math.PI / 4;
  pitch = Math.PI / 6;
  minDistance = 0.5;
  maxDistance = 500;
  rotateSpeed = 0.005;
  zoomSpeed = 0.1;
  panSpeed = 0.002;
  enabled = true;
  /** Auto-rotate speed in rad/s (0 = off). */
  autoRotate = 0;

  constructor(readonly transform: Transform, readonly input: Input | null = null) {}

  /** Apply input and write the camera transform. */
  update(dt: number): void {
    const inp = this.input;
    if (inp && this.enabled) {
      const m = inp.mouse;
      if (m.held(0) || m.held(2)) {
        this.yaw -= m.delta.x * this.rotateSpeed;
        this.pitch = clamp(this.pitch + m.delta.y * this.rotateSpeed, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      }
      if (m.held(1) || (m.held(0) && inp.keyboard.held('ShiftLeft'))) {
        const right = this.transform.right();
        const up = this.transform.up();
        const k = this.distance * this.panSpeed;
        this.target.addScaled(right, -m.delta.x * k).addScaled(up, m.delta.y * k);
      }
      if (m.wheel !== 0) this.distance = clamp(this.distance * (1 + Math.sign(m.wheel) * this.zoomSpeed), this.minDistance, this.maxDistance);
      if (inp.touch.touches.length === 1) {
        const t = inp.touch.touches[0];
        this.yaw -= t.delta.x * this.rotateSpeed;
        this.pitch = clamp(this.pitch + t.delta.y * this.rotateSpeed, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      }
    }
    this.yaw += this.autoRotate * dt;
    this.apply();
  }

  /** Write position/rotation for the current yaw/pitch/distance. */
  apply(): void {
    const cp = Math.cos(this.pitch);
    const x = this.target.x + this.distance * cp * Math.sin(this.yaw);
    const y = this.target.y + this.distance * Math.sin(this.pitch);
    const z = this.target.z + this.distance * cp * Math.cos(this.yaw);
    this.transform.setPosition(x, y, z);
    this.transform.updateWorldMatrix();
    this.transform.lookAt(this.target);
  }
}
