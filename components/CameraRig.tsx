import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface CameraRigProps {
  zoomFactor: number; // 0 to 1
}

export const CameraRig: React.FC<CameraRigProps> = ({ zoomFactor }) => {
  const { camera } = useThree();
  const vec = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    // Zoom Factor 0 = Far
    // Zoom Factor 1 = Close
    
    // Adjusted for larger tree (Radius ~9.5)
    // Close limit increased to 14 to avoid clipping into branches
    // Far limit increased to 75 to frame the massive tree
    const targetZ = THREE.MathUtils.lerp(75, 14.0, zoomFactor);
    
    // Smoothly interpolate current position to target
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, delta * 2.0);
    
    // Ensure camera always looks at center slightly elevated
    vec.current.set(0, 5, 0); // Look slightly higher (tree is taller now)
    camera.lookAt(vec.current);
  });

  return null;
};