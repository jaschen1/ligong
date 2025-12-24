import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TreeState } from '../types';
import { randomPointInSphere } from '../utils/math';

interface GoldenSpiralsProps {
  treeState: TreeState;
}

// Adjusted to fit the larger tree (Radius 9.0)
const BASE_RADIUS = 9.5; 
const TOP_RADIUS = 0.5;
// For 2 strands, fewer loops looks more elegant/classic
const LOOPS = 3.5; 
const STRANDS = 2; // Reverted to 2 strands as requested
// Increased particles per strand significantly so the 2 ribbons look thick and luxurious
const PARTICLES_PER_STRAND = 2000;
const TOTAL_PARTICLES = STRANDS * PARTICLES_PER_STRAND;
const CHAOS_RADIUS = 18; 

export const GoldenSpirals: React.FC<GoldenSpiralsProps> = ({ treeState }) => {
  const pointsRef = useRef<THREE.Points>(null);
  // We use a ref for the shader material to update uniforms
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const progressRef = useRef(0);

  // Generate the glowing texture
  const glowTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        // More intense center for LED look
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');     
        gradient.addColorStop(0.3, 'rgba(255, 240, 150, 1)'); 
        gradient.addColorStop(0.6, 'rgba(255, 215, 0, 0.5)');   
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');           
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  const data = useMemo(() => {
    const chaos = new Float32Array(TOTAL_PARTICLES * 3);
    const target = new Float32Array(TOTAL_PARTICLES * 3);
    const current = new Float32Array(TOTAL_PARTICLES * 3);
    const phases = new Float32Array(TOTAL_PARTICLES); // For individual twinkling
    
    for (let s = 0; s < STRANDS; s++) {
        const strandOffset = (Math.PI * 2 * s) / STRANDS; 

        for (let i = 0; i < PARTICLES_PER_STRAND; i++) {
            // --- Target Calculation (Spiral) ---
            const t = i / PARTICLES_PER_STRAND;
            // Spans roughly from tree bottom (-3.6) to top (15)
            const y = -3.5 + t * 18.0; 
            const currentRadius = THREE.MathUtils.lerp(BASE_RADIUS, TOP_RADIUS, t);
            const angle = t * Math.PI * 2 * LOOPS + strandOffset;

            const x = Math.cos(angle) * currentRadius;
            const z = Math.sin(angle) * currentRadius;

            // Jitter
            const jitterAmt = 0.2;
            const jx = (Math.random() - 0.5) * jitterAmt;
            const jy = (Math.random() - 0.5) * jitterAmt;
            const jz = (Math.random() - 0.5) * jitterAmt;

            const idx = (s * PARTICLES_PER_STRAND + i) * 3;
            target[idx] = x + jx;
            target[idx + 1] = y + jy;
            target[idx + 2] = z + jz;

            // --- Chaos Calculation (Sphere) ---
            const cPos = randomPointInSphere(CHAOS_RADIUS);
            chaos[idx] = cPos.x;
            chaos[idx + 1] = cPos.y;
            chaos[idx + 2] = cPos.z;

            // Initial Position (Chaos)
            current[idx] = chaos[idx];
            current[idx + 1] = chaos[idx + 1];
            current[idx + 2] = chaos[idx + 2];

            // Random phase 0 to 2PI for twinkling
            phases[s * PARTICLES_PER_STRAND + i] = Math.random() * Math.PI * 2;
        }
    }
    return { chaos, target, current, phases };
  }, []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uTexture: { value: glowTexture },
    uColor: { value: new THREE.Color("#FFD700") },
    uGlobalOpacity: { value: 0.0 }
  }), [glowTexture]);

  useFrame((state, delta) => {
    if (!pointsRef.current || !shaderMaterialRef.current) return;

    // 0. Update Time for Shader (Twinkling)
    shaderMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;

    // 1. Transition Progress
    const targetP = treeState === TreeState.FORMED ? 1 : 0;
    progressRef.current = THREE.MathUtils.lerp(progressRef.current, targetP, delta * 2.5);
    const p = progressRef.current;
    const invP = 1 - p;

    // 2. Interpolate Positions (CPU)
    const positions = pointsRef.current.geometry.attributes.position;
    for (let i = 0; i < TOTAL_PARTICLES; i++) {
        const idx = i * 3;
        const x = data.chaos[idx] * invP + data.target[idx] * p;
        const y = data.chaos[idx + 1] * invP + data.target[idx + 1] * p;
        const z = data.chaos[idx + 2] * invP + data.target[idx + 2] * p;
        positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;

    // 3. Rotation & Animation
    pointsRef.current.rotation.y += delta * 0.1;
    // Gentle bobbing
    pointsRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.2;

    // 4. Opacity Transition via Uniform
    // When chaotic, hide slightly; when formed, full brightness
    const targetOpacity = treeState === TreeState.FORMED ? 1.0 : 0.0; 
    shaderMaterialRef.current.uniforms.uGlobalOpacity.value = THREE.MathUtils.lerp(
        shaderMaterialRef.current.uniforms.uGlobalOpacity.value,
        targetOpacity,
        delta * 2.0
    );
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute 
            attach="attributes-position" 
            count={TOTAL_PARTICLES} 
            array={data.current} 
            itemSize={3} 
        />
        <bufferAttribute 
            attach="attributes-aPhase" 
            count={TOTAL_PARTICLES} 
            array={data.phases} 
            itemSize={1} 
        />
      </bufferGeometry>
      <shaderMaterial
        ref={shaderMaterialRef}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`
          uniform float uTime;
          attribute float aPhase;
          varying float vAlpha;
          
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            
            // Size attenuation
            // Reduced to 160.0 (20% smaller than 200.0)
            gl_PointSize = 160.0 / -mvPosition.z; 

            // Twinkle Logic:
            // High frequency sine wave mixed with the random phase
            // Result is a blink from ~0.2 to 1.0
            float blink = 0.5 + 0.5 * sin(uTime * 4.0 + aPhase);
            // Sharpen the blink to look more like an LED turning on/off
            blink = pow(blink, 1.5); 

            // Increased base brightness from 0.3 to 0.6
            vAlpha = 0.6 + 0.4 * blink;
          }
        `}
        fragmentShader={`
          uniform sampler2D uTexture;
          uniform vec3 uColor;
          uniform float uGlobalOpacity;
          varying float vAlpha;
          
          void main() {
            vec4 texColor = texture2D(uTexture, gl_PointCoord);
            if (texColor.a < 0.01) discard;
            
            // Final color = Gold * Texture * Twinkle Alpha * Global Fade * BOOST (2.0)
            gl_FragColor = vec4(uColor, texColor.a * vAlpha * uGlobalOpacity * 2.0);
          }
        `}
      />
    </points>
  );
};