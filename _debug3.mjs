import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from './src/physics/index.js';
import { SurfaceId } from './src/shared/enums.js';

const ledgeHeight = 0.4;
const world = new PhysicsWorld({ cellSize: 8 });
world.addStaticBox(new Vector3(0, -0.5, 0), new Vector3(20, 0.5, 20), new Quaternion(), SurfaceId.CONCRETE, 0);
world.addStaticBox(new Vector3(6, ledgeHeight / 2, 0), new Vector3(4, ledgeHeight / 2, 4), new Quaternion(), SurfaceId.CONCRETE, 0);

const radius = 0.42, height = 1.85, stepHeight = 0.42;
const ch = world.addCharacter({ position: new Vector3(1.55, 0, 0), radius, height, stepHeight, maxSlopeDeg: 48, entityId: 1 });

// manually probe the up-sweep and down-sweep the character code would use
const UP = new Vector3(0,1,0), DOWN = new Vector3(0,-1,0);
const start = ch.position.clone();
console.log('start', start);

const topOrigin = new Vector3(start.x, start.y + height - radius, start.z);
const upHit = world._sphereCastStatics(topOrigin, UP, radius, stepHeight, null);
console.log('upHit', upHit && {d: upHit.distance, n: upHit.normal.toArray()});

const liftDist = upHit ? Math.max(0, upHit.distance - 0.001) : stepHeight;
console.log('liftDist', liftDist);

const raisedStart = new Vector3(start.x, start.y + liftDist, start.z);
console.log('raisedStart', raisedStart);

// try findPenetration manually at raisedStart + forward disp
const disp = new Vector3(0.5, 0, 0);
const candidate = raisedStart.clone().add(disp);
console.log('candidate (raised+disp)', candidate);
