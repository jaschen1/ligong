import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TreeState } from '../types';

interface GroundRipplesProps {
  treeState: TreeState;
}

// Reduced count by 20% (450,000 * 0.8 = 360,000)
const COUNT = 360000; 
const RADIUS = 58; 

export const GroundRipples: React.FC<GroundRipplesProps> = ({ treeState }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const opacityRef = useRef(0);

  const data = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const randoms = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      const r = Math.sqrt(Math.random()) * RADIUS; 
      const theta = Math.random() * Math.PI * 2;
      
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      const y = 0; 

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      randoms[i] = Math.random();
    }
    return { positions, randoms };
  }, []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uGlobalOpacity: { value: 0 },
    uColorDeep: { value: new THREE.Color("#444444") }, 
    // Reduced high brightness by 20% (#FFFFFF -> #CCCCCC)
    uColorHigh: { value: new THREE.Color("#CCCCCC") },    
  }), []);

  useFrame((state, delta) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      
      const targetOpacity = treeState === TreeState.FORMED ? 1.0 : 0.0;
      opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, targetOpacity, delta * 2.5);
      shaderRef.current.uniforms.uGlobalOpacity.value = opacityRef.current;
      
      if (pointsRef.current) {
          pointsRef.current.rotation.y = -state.clock.elapsedTime * 0.012;
      }
    }
  });

  return (
    <group position={[0, -5.5, 0]} rotation={[20 * (Math.PI / 180), 0, 0]}>
        <points ref={pointsRef}>
        <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={COUNT} array={data.positions} itemSize={3} />
            <bufferAttribute attach="attributes-aRandom" count={COUNT} array={data.randoms} itemSize={1} />
        </bufferGeometry>
        <shaderMaterial
            ref={shaderRef}
            transparent={true}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            uniforms={uniforms}
            vertexShader={`
            uniform float uTime;
            uniform float uGlobalOpacity;
            attribute float aRandom;
            
            varying float vAlpha;
            varying float vHeight;

            void main() {
                vec3 pos = position;
                float r = length(pos.xz);
                float angle = atan(pos.z, pos.x);

                float distortion = sin(angle * 3.0 + uTime * 0.2) * 2.8 + 
                                   cos(angle * 7.0 - uTime * 0.1) * 1.5 +
                                   sin(angle * 12.0) * 0.6;
                
                float distortedR = r + distortion * smoothstep(5.0, 45.0, r);

                float frequency = 1.4; 
                float spiral = 5.0;    
                float speed = 0.45;      
                
                float wave = sin(distortedR * frequency - angle * spiral + uTime * speed);
                float noise = sin(r * 0.7 + uTime * 0.25) * sin(angle * 4.0);
                
                float height = wave + noise * 0.25; 
                pos.y += height * 0.8;

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mvPosition;

                float sizeFactor = smoothstep(-1.0, -0.4, height); 
                float baseSize = 18.0 + aRandom * 12.0;
                gl_PointSize = baseSize * (0.6 + sizeFactor * 0.6) * (15.0 / -mvPosition.z);

                vHeight = height;
                
                float radialLimit = uGlobalOpacity * 75.0; 
                float radialFade = smoothstep(radialLimit, radialLimit - 20.0, r);
                
                float edgeFade = 1.0 - smoothstep(42.0, 58.0, r);
                float centerFade = smoothstep(3.0, 10.0, r);
                
                vAlpha = edgeFade * centerFade * radialFade;
            }
            `}
            fragmentShader={`
            uniform float uGlobalOpacity;
            uniform vec3 uColorDeep;
            uniform vec3 uColorHigh;
            
            varying float vAlpha;
            varying float vHeight;

            void main() {
                vec2 center = vec2(0.5, 0.5);
                float dist = distance(gl_PointCoord, center);
                if (dist > 0.5) discard;
                
                float glow = 1.0 - (dist * 2.0);
                glow = pow(glow, 5.0); 

                float mixFactor = smoothstep(-1.0, -0.4, vHeight);
                vec3 color = mix(uColorDeep, uColorHigh, mixFactor);
                
                // Final brightness multiplier reduced from 0.95 to 0.76 (approx 20% reduction)
                gl_FragColor = vec4(color, vAlpha * glow * uGlobalOpacity * 0.76);
            }
            `}
        />
        </points>
    </group>
  );
};