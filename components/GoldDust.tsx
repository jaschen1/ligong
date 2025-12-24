import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TreeState } from '../types';

const COUNT = 2000;

interface GoldDustProps {
  treeState: TreeState;
}

export const GoldDust: React.FC<GoldDustProps> = ({ treeState }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const progressRef = useRef(0);

  const glowTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');     
        gradient.addColorStop(0.2, 'rgba(255, 240, 200, 0.9)'); 
        gradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.3)');   
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');           
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  const data = useMemo(() => {
    const chaos = new Float32Array(COUNT * 3);
    const target = new Float32Array(COUNT * 3);
    const current = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    
    for (let i = 0; i < COUNT; i++) {
      // Larger chaos spread
      chaos[i * 3] = (Math.random() - 0.5) * 40;
      chaos[i * 3 + 1] = (Math.random() - 0.5) * 40;
      chaos[i * 3 + 2] = (Math.random() - 0.5) * 25;

      // Larger target cone
      const h = (Math.random() - 0.5) * 20; // Height spread +/- 10
      const relH = (h + 10) / 20; 
      // Base radius ~10, Top ~1
      const radius = (1 - relH) * 9.5 + 1.0; 
      const angle = h * 2 + (i % 2 === 0 ? 0 : Math.PI); 
      
      target[i * 3] = Math.cos(angle) * radius;
      target[i * 3 + 1] = h + 5; // Lift up to center on tree center (approx y=5)
      target[i * 3 + 2] = Math.sin(angle) * radius;

      current[i * 3] = chaos[i * 3];
      current[i * 3 + 1] = chaos[i * 3 + 1];
      current[i * 3 + 2] = chaos[i * 3 + 2];
    }
    return { chaos, target, current, velocities };
  }, []);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;

    const targetP = treeState === TreeState.FORMED ? 1 : 0;
    progressRef.current = THREE.MathUtils.lerp(progressRef.current, targetP, delta * 3.0);
    const p = progressRef.current;
    
    const positionsAttribute = pointsRef.current.geometry.attributes.position;
    
    for (let i = 0; i < COUNT; i++) {
      const idx = i * 3;
      
      const homeX = data.chaos[idx] * (1 - p) + data.target[idx] * p;
      const homeY = data.chaos[idx + 1] * (1 - p) + data.target[idx + 1] * p;
      const homeZ = data.chaos[idx + 2] * (1 - p) + data.target[idx + 2] * p;

      let px = positionsAttribute.getX(i);
      let py = positionsAttribute.getY(i);
      let pz = positionsAttribute.getZ(i);

      // Physics - Very loose springs for slow, floating dust
      const springStr = 0.01; 
      data.velocities[idx] += (homeX - px) * springStr;
      data.velocities[idx + 1] += (homeY - py) * springStr;
      data.velocities[idx + 2] += (homeZ - pz) * springStr;

      if (p > 0.8) {
        // Microscopic spiral spin
        const angle = Math.atan2(pz, px);
        const tangX = -Math.sin(angle);
        const tangZ = Math.cos(angle);
        
        data.velocities[idx] += tangX * 0.0005;
        data.velocities[idx + 2] += tangZ * 0.0005;
      }

      // High friction for suspended feel
      data.velocities[idx] *= 0.92;
      data.velocities[idx + 1] *= 0.92;
      data.velocities[idx + 2] *= 0.92;

      px += data.velocities[idx];
      py += data.velocities[idx + 1];
      pz += data.velocities[idx + 2];

      positionsAttribute.setXYZ(i, px, py, pz);
    }

    positionsAttribute.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={COUNT}
          array={data.current}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        map={glowTexture}
        size={0.25} 
        color="#FFD700"
        transparent={true}
        opacity={0.9}
        sizeAttenuation={true}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};