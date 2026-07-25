globalThis.__PHYS_DEBUG = true;
import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from './src/physics/index.js';
import { SurfaceId } from './src/shared/enums.js';

const ledgeHeight = 0.4;
const world = new PhysicsWorld({ cellSize: 8 });
world.addStaticBox(new Vector3(0, -0.5, 0), new Vector3(20, 0.5, 20), new Quaternion(), SurfaceId.CONCRETE, 0);
world.addStaticBox(new Vector3(6, ledgeHeight / 2, 0), new Vector3(4, ledgeHeight / 2, 4), new Quaternion(), SurfaceId.CONCRETE, 0);
const ch = world.addCharacter({ position: new Vector3(1, 0, 0), radius: 0.42, height: 1.85, stepHeight: 0.42, maxSlopeDeg: 48, entityId: 1 });
const disp = new Vector3(0.5, -0.02, 0);
for (let i = 0; i < 2; i++) {
  console.error('=== tick', i);
  ch.move(disp);
  console.error('result', ch.position.x.toFixed(4), ch.position.y.toFixed(4), ch.grounded, ch.lastMoveBlocked);
}
