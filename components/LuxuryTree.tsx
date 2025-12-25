import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TreeState } from '../types';
import { randomPointInSphere } from '../utils/math';

interface LuxuryTreeProps {
  treeState: TreeState;
  extraRotationVelocity?: React.MutableRefObject<number>;
  userTextureUrls: string[]; // 传入的可能是 blob: 链接，也可能是 https:// 链接
  isPhotoFocused: boolean;
  zoomFactor: number;
}

// ---------------- 常量定义 ----------------
const NEEDLE_COUNT = 220000;
const ORNAMENT_COUNT = 650;
const TREE_HEIGHT = 19.0;
const TREE_RADIUS = 9.0;
const CHAOS_RADIUS = 18;
const TREE_TIERS = 9;
const TREE_TOP_Y = 0.8 * TREE_HEIGHT;
const MAX_USER_PHOTOS = 15; // 限制最大照片数量

enum OrnamentType {
  SPHERE = 0,
  BOX = 1,
  GEM = 2,
  USER = 3,
  HEPTAGRAM = 4
}

// ---------------- 辅助函数 (保持不变) ----------------
const createHammeredBumpMap = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const r = Math.random() * 20 + 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    g.addColorStop(1, 'rgba(128, 128, 128, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
};

const createGiftWrapBumpMap = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 1024, 1024);
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 20;
    data[i] = Math.max(0, Math.min(255, 128 + noise));
    data[i + 1] = Math.max(0, Math.min(255, 128 + noise));
    data[i + 2] = Math.max(0, Math.min(255, 128 + noise));
  }
  ctx.putImageData(imgData, 0, 0);
  ctx.fillStyle = '#FFFFFF';
  const ribbonWidth = 150;
  ctx.fillRect(512 - ribbonWidth / 2, 0, ribbonWidth, 1024);
  ctx.fillRect(0, 512 - ribbonWidth / 2, 1024, ribbonWidth);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
};

const createVelvetBumpMap = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imgData = ctx.createImageData(512, 512);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const val = Math.random() * 255;
    imgData.data[i] = val;
    imgData.data[i + 1] = val;
    imgData.data[i + 2] = val;
    imgData.data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
};

const createGoldLeafMap = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  for (let i = 0; i < 1000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
};

const SantaHat = () => {
  const velvetMap = useMemo(() => createVelvetBumpMap(), []);
  const whiteTrimMap = useMemo(() => createVelvetBumpMap(), []);
  const redFabricMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#D40000",
    roughness: 0.9,
    bumpMap: velvetMap,
    bumpScale: 0.05,
  }), [velvetMap]);
  const whiteFabricMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 1.0,
    bumpMap: whiteTrimMap,
    bumpScale: 0.1,
  }), [whiteTrimMap]);
  return (
    <group position={[0, TREE_TOP_Y + 0.4, 0]} rotation={[0.1, 0, 0.1]} scale={[2.5, 2.5, 2.5]}>
      <mesh position={[0, 0, 0]} material={whiteFabricMat}>
        <torusGeometry args={[0.5, 0.2, 16, 32]} />
      </mesh>
      <mesh position={[0, 0.8, 0]} material={redFabricMat}>
        <coneGeometry args={[0.45, 1.8, 64]} />
      </mesh>
      <mesh position={[0, 1.7, 0]} material={whiteFabricMat}>
        <sphereGeometry args={[0.22, 32, 32]} />
      </mesh>
    </group>
  );
};

const createHeptagramShape = () => {
  const shape = new THREE.Shape();
  const points = 7;
  const outerRadiusBase = 1.0;
  const innerRadiusBase = 0.5;
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2;
    const isTip = i % 2 === 0;
    const variance = Math.sin(i * 123.45) * 0.15;
    const r = isTip ? outerRadiusBase + variance : innerRadiusBase + variance * 0.5;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
};

const createPolaroidGeometry = () => {
  // Increased thickness slightly for better "luster" reflection
  const cardW = 1.25; const cardH = 1.65; const cardD = 0.08;
  const imageW = 1.0; const imageH = 1.333;
  const box = new THREE.BoxGeometry(cardW, cardH, cardD);
  const boxNonIndexed = box.toNonIndexed();

  // Photo part
  const front = new THREE.PlaneGeometry(imageW, imageH);
  front.translate(0, 0.1, cardD / 2 + 0.01);
  const frontNonIndexed = front.toNonIndexed();

  const back = new THREE.PlaneGeometry(imageW, imageH);
  back.rotateY(Math.PI);
  back.translate(0, 0.1, -cardD / 2 - 0.01);
  const backNonIndexed = back.toNonIndexed();

  const totalCount = boxNonIndexed.attributes.position.count + frontNonIndexed.attributes.position.count + backNonIndexed.attributes.position.count;
  const positions = new Float32Array(totalCount * 3);
  const normals = new Float32Array(totalCount * 3);
  const finalUVs = new Float32Array(totalCount * 2);

  let vOffset = 0;
  // Material 0: The Gold Frame
  positions.set(boxNonIndexed.attributes.position.array, vOffset * 3);
  normals.set(boxNonIndexed.attributes.normal.array, vOffset * 3);
  finalUVs.set(boxNonIndexed.attributes.uv.array, vOffset * 2);
  vOffset += boxNonIndexed.attributes.position.count;

  // Material 1: The Image (front and back)
  positions.set(frontNonIndexed.attributes.position.array, vOffset * 3);
  normals.set(frontNonIndexed.attributes.normal.array, vOffset * 3);
  finalUVs.set(frontNonIndexed.attributes.uv.array, vOffset * 2);
  vOffset += frontNonIndexed.attributes.position.count;

  positions.set(backNonIndexed.attributes.position.array, vOffset * 3);
  normals.set(backNonIndexed.attributes.normal.array, vOffset * 3);
  finalUVs.set(backNonIndexed.attributes.uv.array, vOffset * 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(finalUVs, 2));
  geo.addGroup(0, boxNonIndexed.attributes.position.count, 0);
  geo.addGroup(boxNonIndexed.attributes.position.count, frontNonIndexed.attributes.position.count + backNonIndexed.attributes.position.count, 1);
  return geo;
};

const randomPointInPineTree = (height: number, maxRadius: number, tiers: number): THREE.Vector3 => {
  const normalizedH = Math.random();
  const y = (normalizedH - 0.2) * height;
  const overallTaper = 1 - normalizedH;
  const tierPos = normalizedH * tiers;
  const tierProgress = tierPos % 1;
  const tierFlare = (1 - tierProgress);
  const currentMaxRadius = maxRadius * (overallTaper * 0.7 + tierFlare * 0.3 * overallTaper);
  const r = Math.sqrt(Math.random()) * currentMaxRadius;
  const angle = Math.random() * Math.PI * 2;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  return new THREE.Vector3(x, y, z);
};

const applyCoverFor34 = (tex: THREE.Texture) => {
  const frameAspect = 3 / 4;
  const img = tex.image as HTMLImageElement;
  const imgW = img?.width || 1;
  const imgH = img?.height || 1;
  const imgAspect = imgW / imgH;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.center.set(0.5, 0.5);
  if (imgAspect > frameAspect) {
    const rx = frameAspect / imgAspect;
    tex.repeat.set(rx, 1);
    tex.offset.set((1 - rx) * 0.5, 0);
  } else {
    const ry = imgAspect / frameAspect;
    tex.repeat.set(1, ry);
    tex.offset.set(0, (1 - ry) * 0.5);
  }
  tex.needsUpdate = true;
};

// ---------------- 主组件 ----------------
export const LuxuryTree: React.FC<LuxuryTreeProps> = ({ treeState, extraRotationVelocity, userTextureUrls, isPhotoFocused, zoomFactor }) => {
  const groupRef = useRef<THREE.Group>(null);
  const needlesRef = useRef<THREE.Points>(null);
  const needlesMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const focusedGroupRef = useRef<THREE.Group>(null);
  const [activeTexture, setActiveTexture] = useState<THREE.Texture | null>(null);
  const { camera } = useThree();
  const sphereMeshRef = useRef<THREE.InstancedMesh>(null);
  const boxMeshRef = useRef<THREE.InstancedMesh>(null);
  const gemMeshRef = useRef<THREE.InstancedMesh>(null);
  const userMeshRefs = useRef<THREE.InstancedMesh[]>([]);
  const heptagramMeshRef = useRef<THREE.InstancedMesh>(null);
  const [loadedTextures, setLoadedTextures] = useState<THREE.Texture[]>([]);

  // ---------------- 修改后的纹理加载逻辑 ----------------
  // 这个 useEffect 能够同时处理：本地blob预览 和 远程OSS链接
  useEffect(() => {
    // 1. 如果没有 URL，清空纹理
    if (!userTextureUrls || userTextureUrls.length === 0) {
      setLoadedTextures([]);
      return;
    }

    // 2. 截取前 15 张
    const limitedUrls = userTextureUrls.slice(0, MAX_USER_PHOTOS);

    const loader = new THREE.TextureLoader();
    // 关键：允许加载跨域图片 (对OSS必须，对本地blob无影响)
    loader.setCrossOrigin('anonymous');

    let cancelled = false;

    // 3. 构建加载队列
    const loadPromises = limitedUrls.map((url) => {
      return new Promise<THREE.Texture | null>((resolve) => {
        
        let loadUrl = url;
        
        // 【关键判断】：区分本地预览和远程分享
        // 如果是本地 Blob (预览模式)，千万不能加 ?t=...，否则会破坏 Blob 链接
        const isLocalPreview = url.startsWith('blob:');

        if (!isLocalPreview) {
          // 如果是远程链接 (分享模式)，为了解决 CORS 缓存问题，我们追加时间戳
          const separator = url.includes('?') ? '&' : '?';
          loadUrl = `${url}${separator}t=${new Date().getTime()}`;
        }

        // 开始加载
        loader.load(
          loadUrl,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearMipMapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            resolve(tex);
          },
          undefined,
          (err) => {
            // 如果是 404，通常意味着传入的 url 只是文件名而不是完整链接
            console.warn(`[Texture Error] Failed to load: ${loadUrl}`, err);
            resolve(null);
          }
        );
      });
    });

    // 4. 并行加载并过滤
    Promise.all(loadPromises).then((results) => {
      if (cancelled) return;
      // 过滤掉 null
      const successfulTextures = results.filter((tex): tex is THREE.Texture => tex !== null);
      if (successfulTextures.length > 0) {
        console.log(`Loaded ${successfulTextures.length} / ${limitedUrls.length} images.`);
      }
      setLoadedTextures(successfulTextures);
    });

    return () => {
      cancelled = true;
    };
  }, [userTextureUrls]);


  // ---------------- 材质与资源 (保持不变) ----------------
  const sphereBumpMap = useMemo(() => createHammeredBumpMap(), []);
  const boxBumpMap = useMemo(() => createGiftWrapBumpMap(), []);
  const starBumpMap = useMemo(() => createGoldLeafMap(), []);
  const particleTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 64, 64);
      ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  const polaroidBaseMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: "#FFD700",
    metalness: 1.0,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    envMapIntensity: 3.5,
    reflectivity: 1.0
  }), []);

  const focusedFrameMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: "#FFD700",
    metalness: 1.0,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    envMapIntensity: 3.5,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
  }), []);

  const photoMaterials = useMemo(() => loadedTextures.map(tex => {
    const frameAspect = 3 / 4; const img = tex.image as HTMLImageElement;
    const imgW = img?.width || 1; const imgH = img?.height || 1;
    const imgAspect = imgW / imgH;
    tex.center.set(0.5, 0.5); tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    if (imgAspect > frameAspect) tex.repeat.set(frameAspect / imgAspect, 1);
    else tex.repeat.set(1, imgAspect / frameAspect);
    return new THREE.MeshStandardMaterial({
      map: tex, metalness: 0.1, roughness: 0.6, color: '#ffffff', side: THREE.DoubleSide,
      emissive: '#000000', emissiveMap: tex, emissiveIntensity: 0.4, toneMapped: false
    });
  }), [loadedTextures]);

  const activeMaterial = useMemo(() => {
    if (!activeTexture) return null;
    return new THREE.MeshBasicMaterial({
      map: activeTexture, color: '#ffffff', side: THREE.DoubleSide,
      transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false,
    });
  }, [activeTexture]);

  const heptagramMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#FFD700", metalness: 1.0, roughness: 0.3, bumpMap: starBumpMap, bumpScale: 0.02,
    emissive: "#FF6600", emissiveIntensity: 1.0, toneMapped: false, envMapIntensity: 2.0
  }), [starBumpMap]);

  const sphereMaterial = useMemo(() => {
    return new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      bumpMap: sphereBumpMap,
      bumpScale: 0.03,
      envMapIntensity: 2.5,
      emissive: "#000000",
      emissiveIntensity: 0.0
    });
  }, [sphereBumpMap]);

  const boxMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    metalness: 0.1, roughness: 0.4, bumpMap: boxBumpMap, bumpScale: 0.05, envMapIntensity: 0.8
  }), [boxBumpMap]);

  const gemMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: "#FFFFFF", metalness: 0.1, roughness: 0.0, transmission: 0.6, thickness: 1.0,
    envMapIntensity: 3.0, emissive: "#FFFFFF", emissiveIntensity: 0.2, toneMapped: false
  }), []);

  const polaroidGeometry = useMemo(() => createPolaroidGeometry(), []);

  const heptagramGeometry = useMemo(() => {
    const shape = createHeptagramShape();
    const extrudeSettings = { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4 };
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, []);

  const velocity = useRef(0);
  const [activeFocusIndex, setActiveFocusIndex] = useState<number>(-1);
  const prevFocusState = useRef(false);

  // ---------------- 数据生成 (保持不变) ----------------
  const needleData = useMemo(() => {
    const chaos = new Float32Array(NEEDLE_COUNT * 3);
    const target = new Float32Array(NEEDLE_COUNT * 3);
    const colors = new Float32Array(NEEDLE_COUNT * 3);
    const randoms = new Float32Array(NEEDLE_COUNT);
    const c1 = new THREE.Color("#4ade80"); const c2 = new THREE.Color("#22c55e"); const c3 = new THREE.Color("#15803d");
    const tmp = new THREE.Color();
    for (let i = 0; i < NEEDLE_COUNT; i++) {
      const tPos = randomPointInPineTree(TREE_HEIGHT, TREE_RADIUS, TREE_TIERS);
      target[i * 3] = tPos.x; target[i * 3 + 1] = tPos.y; target[i * 3 + 2] = tPos.z;
      const cPos = randomPointInSphere(CHAOS_RADIUS);
      chaos[i * 3] = cPos.x; chaos[i * 3 + 1] = cPos.y; chaos[i * 3 + 2] = cPos.z;
      const r = Math.random();
      if (r < 0.33) tmp.copy(c1); else if (r < 0.66) tmp.copy(c2); else tmp.copy(c3);
      tmp.offsetHSL(0, 0.05, (Math.random() - 0.5) * 0.1);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
      randoms[i] = Math.random();
    }
    return { chaos, target, colors, randoms };
  }, []);

  const { ornamentData, counts, userCounts } = useMemo(() => {
    const data = [];
    const bColors = [new THREE.Color("#8B0000"), new THREE.Color("#FFFFFF"), new THREE.Color("#D4AF37")];
    const gColors = [new THREE.Color("#FFFFFF"), new THREE.Color("#E0FFFF")];
    let sCount = 0, bCount = 0, gCount = 0, hCount = 0;
    const uCounts = new Array(Math.max(1, loadedTextures.length)).fill(0);

    const goldColor = new THREE.Color("#FFD700");
    const redColor = new THREE.Color("#D40000");

    for (let i = 0; i < ORNAMENT_COUNT; i++) {
      let tPos = randomPointInPineTree(TREE_HEIGHT, TREE_RADIUS * 0.95, TREE_TIERS);
      const cPos = randomPointInSphere(CHAOS_RADIUS * 0.975);
      let type = OrnamentType.SPHERE;
      const rand = Math.random(); let textureIndex = -1;

      // 如果有加载成功的图片，则有机会生成相片
      if (loadedTextures.length > 0 && rand > 0.85) {
        type = OrnamentType.USER;
        textureIndex = Math.floor(Math.random() * loadedTextures.length);
        uCounts[textureIndex]++;
      } else {
        if (rand < 0.15) { type = OrnamentType.HEPTAGRAM; hCount++; }
        else if (rand < 0.50) { type = OrnamentType.SPHERE; sCount++; }
        else if (rand < 0.75) { type = OrnamentType.BOX; bCount++; }
        else { type = OrnamentType.GEM; gCount++; }
      }

      let color = new THREE.Color();
      let scale = new THREE.Vector3(1, 1, 1);
      const baseScale = 0.45 + Math.random() * 0.35;

      if (type === OrnamentType.SPHERE) {
        color.copy((sCount % 2 === 0) ? goldColor : redColor);
        scale.setScalar(baseScale);
      }
      else if (type === OrnamentType.BOX) { color = bColors[Math.floor(Math.random() * bColors.length)]; scale.set(baseScale * 0.8, baseScale * 0.8, baseScale * 0.8); }
      else if (type === OrnamentType.GEM) { color = gColors[Math.floor(Math.random() * gColors.length)]; scale.setScalar(baseScale * 0.8); }
      else if (type === OrnamentType.USER) { scale.setScalar(baseScale * 1.5); }
      else if (type === OrnamentType.HEPTAGRAM) { color = new THREE.Color("#CFB53B"); scale.setScalar(baseScale * 0.9); }

      let localIndex = 0;
      if (type === OrnamentType.SPHERE) localIndex = sCount - 1; if (type === OrnamentType.BOX) localIndex = bCount - 1;
      if (type === OrnamentType.GEM) localIndex = gCount - 1; if (type === OrnamentType.USER) localIndex = uCounts[textureIndex] - 1;
      if (type === OrnamentType.HEPTAGRAM) localIndex = hCount - 1;

      let rotAxis = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
      let rotSpeed = (Math.random() - 0.5) * 2.0;
      if (type === OrnamentType.HEPTAGRAM) { rotSpeed = 0; rotAxis = new THREE.Vector3(0, 1, 0); }
      let alwaysVisible = Math.random() > 0.6; if (type === OrnamentType.USER) alwaysVisible = true;
      data.push({ id: i, tPos, cPos, type, color: color.clone(), scale, textureIndex, localIndex, phase: Math.random() * Math.PI * 2, rotSpeed, rotationAxis: rotAxis, alwaysVisible });
    }
    return { ornamentData: data, counts: { sphere: sCount, box: bCount, gem: gCount, heptagram: hCount }, userCounts: uCounts };
  }, [loadedTextures.length]);

  useEffect(() => {
    if (activeFocusIndex !== -1 && loadedTextures.length > 0) {
      const targetOrn = ornamentData.find(o => o.id === activeFocusIndex);
      if (targetOrn && targetOrn.type === OrnamentType.USER) {
        const srcTex = loadedTextures[targetOrn.textureIndex];
        const focusTex = srcTex.clone(); applyCoverFor34(focusTex);
        setActiveTexture(focusTex); return;
      }
    }
    setActiveTexture(null);
  }, [activeFocusIndex, loadedTextures, ornamentData]);

  const currentProgress = useRef(0); const focusProgress = useRef(0);
  const dummyObj = useMemo(() => new THREE.Object3D(), []); const vec3 = useMemo(() => new THREE.Vector3(), []);
  const needleUniforms = useMemo(() => ({ uTime: { value: 0 }, uTexture: { value: particleTexture }, uProgress: { value: 0 }, uZoom: { value: 0 } }), [particleTexture]);

  // ---------------- 动画帧逻辑 (保持不变) ----------------
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime;
    if (needlesMaterialRef.current) { needleUniforms.uTime.value = time; needleUniforms.uProgress.value = currentProgress.current; needleUniforms.uZoom.value = zoomFactor; }
    if (heptagramMaterial) { heptagramMaterial.emissiveIntensity = 2.5 + Math.sin(time * 3.0) * 1.5; }

    if (isPhotoFocused && !prevFocusState.current) {
      const worldRot = groupRef.current.rotation.y;
      let minDist = Infinity; let nearestId = -1;
      ornamentData.forEach(orn => {
        if (orn.type !== OrnamentType.USER) return;
        const p = currentProgress.current; const invP = 1 - p;
        const bx = orn.cPos.x * invP + orn.tPos.x * p; const by = orn.cPos.y * invP + orn.tPos.y * p; const bz = orn.cPos.z * invP + orn.tPos.z * p;
        const wx = bx * Math.cos(worldRot) + bz * Math.sin(worldRot); const wy = by; const wz = -bx * Math.sin(worldRot) + bz * Math.cos(worldRot);
        const d = (wx - camera.position.x) ** 2 + (wy - camera.position.y) ** 2 + (wz - camera.position.z) ** 2;
        if (d < minDist) { minDist = d; nearestId = orn.id; }
      });
      if (nearestId !== -1) setActiveFocusIndex(nearestId);
    }
    prevFocusState.current = isPhotoFocused;

    const targetProgress = treeState === TreeState.FORMED ? 1 : 0;
    currentProgress.current = THREE.MathUtils.lerp(currentProgress.current, targetProgress, delta * 4.0);
    const p = currentProgress.current; const invP = 1 - p;

    if (needlesRef.current) {
      const pos = needlesRef.current.geometry.attributes.position;
      const waveAmp = (p > 0.1) ? 0.05 * p : 0;
      for (let i = 0; i < NEEDLE_COUNT; i++) {
        let x = needleData.chaos[i * 3] * invP + needleData.target[i * 3] * p; let y = needleData.chaos[i * 3 + 1] * invP + needleData.target[i * 3 + 1] * p; let z = needleData.chaos[i * 3 + 2] * invP + needleData.target[i * 3 + 2] * p;
        if (waveAmp > 0) { const ph = needleData.target[i * 3] * 0.5; x += Math.sin(time * 1.5 + ph) * waveAmp; z += Math.sin(time * 1.5 * 1.2 + ph) * waveAmp; }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }

    focusProgress.current = THREE.MathUtils.lerp(focusProgress.current, isPhotoFocused ? 1 : 0, delta * 5.0);
    const fp = focusProgress.current; const globalScale = THREE.MathUtils.lerp(1.0, 0.72, p);

    ornamentData.forEach((orn) => {
      let x = orn.cPos.x * invP + orn.tPos.x * p; let y = orn.cPos.y * invP + orn.tPos.y * p; let z = orn.cPos.z * invP + orn.tPos.z * p;
      const isFixed = (orn.type === OrnamentType.HEPTAGRAM);
      if (p > 0.1) { const w = 0.05 * p; const ph = orn.tPos.x * 0.5 + orn.tPos.y * 0.5; x += Math.sin(time * 1.5 + ph) * w; y += Math.cos(time * 1.5 * 0.8 + ph) * w * 0.5; z += Math.sin(time * 1.5 * 1.2 + ph) * w; }
      if (p > 0.5 && !isFixed) y += Math.sin(time + orn.phase) * 0.05;
      const isTarget = (orn.id === activeFocusIndex);
      dummyObj.rotation.set(0, 0, 0); let breathe = isFixed ? 1.0 : 1.0 + Math.sin(time * 3 + orn.phase) * 0.05;
      let visibility = orn.alwaysVisible ? 1.0 : THREE.MathUtils.smoothstep(p, 0.1, 0.9);
      const treeScaleVec = orn.scale.clone().multiplyScalar(globalScale * breathe * visibility);
      if (isTarget && fp > 0.001) {
        const dist = 10; const vFOV = (camera as any).fov * Math.PI / 180;
        const targetHeight = (2 * Math.tan(vFOV / 2) * dist) * 0.612; const targetScaleVal = targetHeight / 1.6;
        const targetScaleVec = new THREE.Vector3(targetScaleVal, targetScaleVal, targetScaleVal);
        camera.getWorldDirection(vec3); const worldTargetPos = camera.position.clone().add(vec3.multiplyScalar(dist));
        const worldTargetQuat = camera.quaternion.clone(); const groupInvQuat = groupRef.current!.quaternion.clone().invert();
        const localTargetPos = worldTargetPos.clone().applyQuaternion(groupInvQuat); const localTargetQuat = groupInvQuat.multiply(worldTargetQuat);
        dummyObj.position.lerpVectors(new THREE.Vector3(x, y, z), localTargetPos, fp);
        const tQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, time * 0.2 + orn.phase, Math.sin(time * 0.5 + orn.phase) * 0.1));
        dummyObj.quaternion.slerpQuaternions(tQ, localTargetQuat, fp); dummyObj.scale.lerpVectors(treeScaleVec, targetScaleVec, fp);
        if (focusedGroupRef.current) { focusedGroupRef.current.position.copy(dummyObj.position); focusedGroupRef.current.quaternion.copy(dummyObj.quaternion); focusedGroupRef.current.scale.copy(dummyObj.scale); }
        dummyObj.scale.set(0, 0, 0);
      } else {
        dummyObj.position.set(x, y, z);
        if (isFixed) { dummyObj.lookAt(0, y, 0); dummyObj.rotateY(Math.PI); dummyObj.rotateZ(orn.phase); }
        else if (orn.type === OrnamentType.USER) { dummyObj.rotation.y = time * 0.2 + orn.phase; dummyObj.rotation.x = Math.sin(time * 0.5 + orn.phase) * 0.1; }
        else { dummyObj.rotateOnAxis(orn.rotationAxis, time * orn.rotSpeed + orn.phase); }
        dummyObj.scale.copy(treeScaleVec);
      }
      dummyObj.updateMatrix();

      if (orn.type === OrnamentType.SPHERE && sphereMeshRef.current) {
        sphereMeshRef.current.setMatrixAt(orn.localIndex, dummyObj.matrix);
        sphereMeshRef.current.setColorAt(orn.localIndex, orn.color);
      }
      else if (orn.type === OrnamentType.BOX && boxMeshRef.current) { boxMeshRef.current.setMatrixAt(orn.localIndex, dummyObj.matrix); boxMeshRef.current.setColorAt(orn.localIndex, orn.color); }
      else if (orn.type === OrnamentType.GEM && gemMeshRef.current) { gemMeshRef.current.setMatrixAt(orn.localIndex, dummyObj.matrix); gemMeshRef.current.setColorAt(orn.localIndex, orn.color); }
      else if (orn.type === OrnamentType.HEPTAGRAM && heptagramMeshRef.current) { heptagramMeshRef.current.setMatrixAt(orn.localIndex, dummyObj.matrix); }
      else if (orn.type === OrnamentType.USER && userMeshRefs.current[orn.textureIndex]) { userMeshRefs.current[orn.textureIndex].setMatrixAt(orn.localIndex, dummyObj.matrix); }
    });

    if (sphereMeshRef.current) {
      sphereMeshRef.current.instanceMatrix.needsUpdate = true;
      if (sphereMeshRef.current.instanceColor) sphereMeshRef.current.instanceColor.needsUpdate = true;
    }
    if (boxMeshRef.current) { boxMeshRef.current.instanceMatrix.needsUpdate = true; if (boxMeshRef.current.instanceColor) boxMeshRef.current.instanceColor.needsUpdate = true; }
    if (gemMeshRef.current) { gemMeshRef.current.instanceMatrix.needsUpdate = true; if (gemMeshRef.current.instanceColor) gemMeshRef.current.instanceColor.needsUpdate = true; }
    if (heptagramMeshRef.current) heptagramMeshRef.current.instanceMatrix.needsUpdate = true;
    userMeshRefs.current.forEach(mesh => { if (mesh) mesh.instanceMatrix.needsUpdate = true; });

    if (extraRotationVelocity && !isPhotoFocused) { velocity.current += extraRotationVelocity.current * 0.15; extraRotationVelocity.current = 0; }
    velocity.current *= 0.85;
    if (treeState === TreeState.FORMED && Math.abs(velocity.current) < 0.001 && !isPhotoFocused) velocity.current += (0.00005 - velocity.current) * 0.01;
    groupRef.current.rotation.y += velocity.current;
  });

  return (
    <group ref={groupRef}>
      {treeState === TreeState.FORMED && <SantaHat />}
      <points ref={needlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={NEEDLE_COUNT} array={needleData.chaos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={NEEDLE_COUNT} array={needleData.colors} itemSize={3} />
          <bufferAttribute attach="attributes-aRandom" count={NEEDLE_COUNT} array={needleData.randoms} itemSize={1} />
        </bufferGeometry>
        <shaderMaterial ref={needlesMaterialRef} transparent={true} depthWrite={false} blending={THREE.NormalBlending} uniforms={needleUniforms}
          vertexShader={`uniform float uTime; uniform float uProgress; uniform float uZoom; attribute vec3 color; attribute float aRandom; varying vec3 vColor; varying float vSparkle;
                void main() {
                    if (aRandom > (0.4 + uZoom * 0.6)) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPos;
                    gl_PointSize = mix(0.5, 1.0, uProgress) * 0.12 * (1.0 + uZoom * 0.6) * (200.0 / -mvPos.z);
                    vColor = color; float sh = sin(uTime * 3.0 + aRandom * 20.0); vSparkle = pow(max(0.0, sh), 4.0);
                }`}
          fragmentShader={`uniform sampler2D uTexture; varying vec3 vColor; varying float vSparkle;
                void main() { vec4 tex = texture2D(uTexture, gl_PointCoord); if (tex.a < 0.5) discard;
                    gl_FragColor = vec4(mix(vColor, vec3(1.0, 1.0, 0.8), vSparkle * 0.6), 0.9);
                }`} />
      </points>
      <instancedMesh ref={sphereMeshRef} args={[undefined, undefined, counts.sphere]}><sphereGeometry args={[1, 64, 64]} /><primitive object={sphereMaterial} attach="material" /></instancedMesh>
      <instancedMesh ref={boxMeshRef} args={[undefined, undefined, counts.box]}><boxGeometry args={[1, 1, 1]} /><primitive object={boxMaterial} attach="material" /></instancedMesh>
      <instancedMesh ref={gemMeshRef} args={[undefined, undefined, counts.gem]}><octahedronGeometry args={[1, 0]} /><primitive object={gemMaterial} attach="material" /></instancedMesh>
      <instancedMesh ref={heptagramMeshRef} args={[undefined, undefined, counts.heptagram]} geometry={heptagramGeometry} material={heptagramMaterial} />
      {/* 渲染拍立得相框，基于实际加载成功的图片数量 */}
      {loadedTextures.map((tex, i) => (<instancedMesh key={i} ref={el => { if (el) userMeshRefs.current[i] = el; }} args={[undefined, undefined, userCounts[i]]} geometry={polaroidGeometry} material={[polaroidBaseMaterial, photoMaterials[i]]} />))}
      {activeTexture && activeMaterial && (<group ref={focusedGroupRef} scale={[0, 0, 0]}><mesh material={focusedFrameMaterial} renderOrder={9997}><boxGeometry args={[1.25, 1.65, 0.08]} /></mesh><mesh position={[0, 0.1, 0.06]} renderOrder={9998}><planeGeometry args={[1.0, 1.333]} /><meshBasicMaterial color="black" side={THREE.DoubleSide} transparent opacity={1} depthTest={false} depthWrite={false} /></mesh><mesh material={activeMaterial} position={[0, 0.1, 0.08]} renderOrder={9999}><planeGeometry args={[1.0, 1.333]} /></mesh></group>)}
    </group>
  );
};