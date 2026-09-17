/**
 * Pure flight-model helpers shared by the Driftwind glider script (through
 * `engine.procgen.flight`) and its tests. Conventions: yaw rotates about +Y
 * with forward = -Z at yaw 0, pitch is positive nose-up, bank is positive
 * right-wing-down.
 */
import type { Vec3Like } from '../core/math/Vec3';

/** Unit forward vector for a yaw/pitch pair (written into `out`). */
export function headingForward(yaw: number, pitch: number, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/** Yaw for a horizontal direction (the yaw whose forward points along `dx, dz`). */
export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Yaw rate (rad/s) produced by a bank angle: a banked wing turns, and turns
 * tighten at low speed (`turnRate` is the rate at full bank and cruise speed).
 */
export function bankTurnRate(bank: number, turnRate: number, speed: number, cruise: number): number {
  const k = Math.min(1.6, Math.max(0.55, cruise / Math.max(speed, 8)));
  return 0 - Math.sin(bank) * turnRate * k;
}

/**
 * Airspeed change over `dt`: gravity along the flight path, drag/lift settling
 * toward cruise, optional boost and brake. Returns the new speed, clamped.
 */
export function integrateSpeed(speed: number, pitch: number, dt: number, opts: { cruise: number; stall: number; maxSpeed: number; boostAccel?: number; boosting?: boolean; braking?: boolean }): number {
  let v = speed;
  v += -9.8 * 1.2 * Math.sin(pitch) * dt;
  v += (opts.cruise - v) * 0.32 * dt;
  if (opts.boosting) v += (opts.boostAccel ?? 0) * dt;
  if (opts.braking) v += (opts.stall * 1.15 - v) * 1.8 * dt;
  return Math.min(opts.maxSpeed, Math.max(5, v));
}

export interface GateLike {
  position: Vec3Like;
  yaw: number;
  radius: number;
}

export interface GateCrossing {
  /** Parameter along a→b where the gate plane was crossed. */
  t: number;
  /** Distance from the ring axis at the crossing (0 = dead centre). */
  radial: number;
  /** True when flown through in the course direction. */
  forward: boolean;
}

/**
 * Segment a→b against a ring standing in the vertical plane through
 * `gate.position` with normal (-sin yaw, 0, -cos yaw). Returns the crossing
 * when the segment pierces the plane inside `radius * tolerance`, else null.
 */
export function gateCrossing(a: Vec3Like, b: Vec3Like, gate: GateLike, tolerance = 0.95): GateCrossing | null {
  const c = gate.position;
  const nx = -Math.sin(gate.yaw), nz = -Math.cos(gate.yaw);
  const d0 = (a.x - c.x) * nx + (a.z - c.z) * nz, d1 = (b.x - c.x) * nx + (b.z - c.z) * nz;
  if (d0 * d1 > 0 || d0 === d1) return null;
  const t = d0 / (d0 - d1);
  const px = a.x + (b.x - a.x) * t - c.x, py = a.y + (b.y - a.y) * t - c.y, pz = a.z + (b.z - a.z) * t - c.z;
  const along = px * nx + pz * nz;
  const rx = px - nx * along, rz = pz - nz * along;
  const radial = Math.hypot(rx, py, rz);
  if (radial > gate.radius * tolerance) return null;
  return { t, radial, forward: d0 < 0 && d1 >= 0 };
}

/** Reflect a velocity off a surface normal and blend it with the current heading (a soft bounce). */
export function bounceHeading(vel: Vec3Like, forward: Vec3Like, normal: Vec3Like, blend = 0.55): { yaw: number; pitch: number } | null {
  const vdn = vel.x * normal.x + vel.y * normal.y + vel.z * normal.z;
  if (vdn >= 0) return null;
  const rx = vel.x - 2 * vdn * normal.x, ry = vel.y - 2 * vdn * normal.y, rz = vel.z - 2 * vdn * normal.z;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const bx = forward.x * (1 - blend) + (rx / rl) * blend, by = forward.y * (1 - blend) + (ry / rl) * blend, bz = forward.z * (1 - blend) + (rz / rl) * blend;
  const bl = Math.hypot(bx, by, bz) || 1;
  const pitch = Math.asin(Math.min(1, Math.max(-1, by / bl)));
  return { yaw: yawFromDirection(bx, bz), pitch: Math.min(0.7, Math.max(-0.7, pitch)) };
}
