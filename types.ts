import { Vector3, Color } from 'three';
import 'react';

export enum TreeState {
  CHAOS = 'CHAOS',
  FORMED = 'FORMED'
}

export interface ParticleData {
  chaosPos: Vector3;
  targetPos: Vector3;
  currentPos: Vector3;
  color: Color;
  size: number;
  speed: number;
}

export interface OrnamentData {
  chaosPos: Vector3;
  targetPos: Vector3;
  rotation: Vector3;
  scale: number;
  type: 'box' | 'ball' | 'light';
  color: Color;
}

// Augment global JSX namespace
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
