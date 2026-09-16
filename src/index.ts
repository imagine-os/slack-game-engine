/**
 * Forge Engine public API.
 *
 * ```ts
 * import { Engine, Sprite, RigidBody2D } from 'forge-engine';
 * const engine = Engine.create(canvas, { renderer: '2d' });
 * engine.start();
 * ```
 */
export * from './core';
export * from './input';
export * from './assets';
export * from './audio';
export * from './render';
export * from './physics';
export * from './scripting';
export * from './net';
export * from './ui';
export * from './project';

/** Engine version (kept in sync with package.json). */
export const VERSION = '0.1.0';
