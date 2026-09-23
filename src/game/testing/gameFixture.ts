/**
 * A `Game` for tests, built from its own field initializers without the rest of its constructor, which needs a page
 * and a GPU.
 *
 * Tests used to start from `Object.create(Game.prototype)`, which skips every field initializer: each new field the
 * frame loop read (a scratch vector, a shadow node) arrived undefined and failed dozens of tests at once. Here the
 * real constructor runs until it first reads `graphicsControl`, by which point every field initializer and the
 * graphics settings are in place, and that instance is kept. A new field with an initializer therefore needs nothing
 * here. What the constructor goes on to build and `initialize` adds (renderer, rig, input, HUD layers, ocean, sun,
 * sky, wake, pipeline) is the test's to pass in `fields`, with the inert stand-ins in `fakes.ts`.
 */
import { Game } from '../Game';
import { DEFAULT_GRAPHICS, type GraphicsSettings } from '../graphicsSettings';
import type { GameCallbacks } from '../types';

const stop = Symbol('fields initialized');
/** Every callback is a no-op unless a test passes its own `callbacks`. */
const inert = new Proxy({}, { get: () => () => {} }) as GameCallbacks;

/** A Game with its field defaults, then `fields` assigned over them. */
export function testGame(fields: object, settings: GraphicsSettings = DEFAULT_GRAPHICS): Game {
  const getter = Object.getOwnPropertyDescriptor(Game.prototype, 'graphicsControl');
  if (!getter) throw new Error('Game.graphicsControl is gone; stop testGame at the constructor\'s new first step.');
  let game: Game | undefined;
  Object.defineProperty(Game.prototype, 'graphicsControl', { configurable: true, get() { game = this; throw stop; } });
  try {
    new Game({} as HTMLElement, settings, inert);
  } catch (error) {
    if (error !== stop) throw new Error('The Game constructor needs a page before it reads graphicsControl; stop testGame at its new first step.', { cause: error });
  } finally {
    Object.defineProperty(Game.prototype, 'graphicsControl', getter);
  }
  return Object.assign(game!, fields);
}
