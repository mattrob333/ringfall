import { Vector3, Quaternion } from 'three';
import { PhysicsWorld } from './src/physics/index.js';
import { EventBus } from './src/core/events.js';
import { SIM_DT } from './src/shared/tuning.js';
import { SurfaceId } from './src/shared/enums.js';
import { VehicleSystem } from './src/vehicles/index.js';

const world = new PhysicsWorld({ cellSize: 8 });
world.addStaticBox(new Vector3(0, -1, 0), new Vector3(300, 1, 300), new Quaternion(), SurfaceId.CONCRETE, 0);
const events = new EventBus();
const system = new VehicleSystem({ physics: world, events });
const vehicle = system.spawn({ type: 'ridgeback', position: new Vector3(0, 0.75, 0), yaw: 0 });

for (let i = 0; i < 400; i++) {
  system.update(SIM_DT);
  if (i % 20 === 0 || i > 380) {
    console.log(
      i,
      'y=', vehicle.position.y.toFixed(4),
      'vy=', vehicle.velocity.y.toFixed(4),
      'grounded=', vehicle.wheels.map(w=>w.grounded),
      'comp=', vehicle.wheels.map(w=>w.compression01.toFixed(3)),
    );
  }
}
