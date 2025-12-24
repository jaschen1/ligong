import * as THREE from 'three';

// Generate a random point inside a sphere of radius R
export const randomPointInSphere = (radius: number): THREE.Vector3 => {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  const r = Math.cbrt(Math.random()) * radius;
  const sinPhi = Math.sin(phi);
  return new THREE.Vector3(
    r * sinPhi * Math.cos(theta),
    r * sinPhi * Math.sin(theta),
    r * Math.cos(phi)
  );
};

// Generate a random point on/in a cone (Tree Shape)
export const randomPointInCone = (height: number, baseRadius: number): THREE.Vector3 => {
  const y = (Math.random() - 0.2) * height; // Shift slightly down
  // Radius at this height (linear taper)
  // Normalized height from 0 (bottom) to 1 (top) relative to cone base
  const relY = (y + height * 0.2) / height;
  const currentRadius = (1 - relY) * baseRadius;
  
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * currentRadius; // Sqrt for uniform distribution
  
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  
  return new THREE.Vector3(x, y, z);
};
