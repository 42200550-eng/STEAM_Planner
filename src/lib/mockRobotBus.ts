import type { RobotEventMap } from '../types';

type EventName = keyof RobotEventMap;

type Listener<K extends EventName> = (payload: RobotEventMap[K]) => void;

class MockRobotBus {
  private target = new EventTarget();

  emit<K extends EventName>(type: K, payload: RobotEventMap[K]) {
    this.target.dispatchEvent(new CustomEvent(type, { detail: payload }));
  }

  on<K extends EventName>(type: K, listener: Listener<K>) {
    const wrapped = (event: Event) => {
      const customEvent = event as CustomEvent<RobotEventMap[K]>;
      listener(customEvent.detail);
    };

    this.target.addEventListener(type, wrapped);
    return () => this.target.removeEventListener(type, wrapped);
  }
}

export const mockRobotBus = new MockRobotBus();
