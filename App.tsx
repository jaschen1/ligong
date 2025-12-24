import React, { useState, Suspense, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, useProgress, Environment } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { createClient } from '@supabase/supabase-js'; 

import { TreeState } from './types';
import { LuxuryTree } from './components/LuxuryTree';
import { GoldDust } from './components/GoldDust';
import { GoldenSpirals } from './components/GoldenSpirals';
import { AmbientParticles } from './components/AmbientParticles';
import { Overlay } from './components/Overlay';
import { BackgroundHeader } from './components/BackgroundHeader';
import { HandController } from './components/HandController';
import { CameraRig } from './components/CameraRig';
import { GroundRipples } from './components/GroundRipples';

// --- 初始化 Supabase ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- Intro Loader 组件 (开场动画) ---
const IntroLoader = ({ onComplete }: { onComplete: () => void }) => {
  const [progress, setProgress] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const startTime = Date.now();
    const duration = 3500; // 动画持续时间

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const p = Math.min((elapsed / duration) * 100, 100);
      setProgress(p);

      if (p < 100) {
        requestAnimationFrame(tick);
      } else {
        setIsFading(true);
        setTimeout(() => {
            onComplete();
        }, 1000); 
      }
    };
    
    const frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [onComplete]);

  return (
    <div className={`fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center transition-opacity duration-1000 ease-in-out ${isFading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex flex-col items-center gap-8 w-full max-w-md px-8">
            <h1 className="text-4xl md:text-6xl text-[#FFD700] tracking-widest text-center leading-tight" style={{ fontFamily: '"Playfair Display", serif', fontStyle: 'italic', textShadow: '0 0 20px rgba(255, 215, 0, 0.3)' }}>
                Christmas Tree
            </h1>
            
            <div className="w-full max-w-[240px] h-[1px] bg-[#333333] relative overflow-visible mt-2">
                <div className="h-full bg-[#FFD700] shadow-[0_0_15px_#FFD700] transition-all duration-75 ease-linear" style={{ width: `${progress}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_white,0_0_20px_#FFD700]" style={{ left: `${progress}%`, transition: 'left 0.075s linear' }} />
            </div>
            
            <span className="text-[#FFD700]/60 text-xs tracking-[0.3em] font-serif" style={{ fontFamily: '"Playfair Display", serif' }}>
                LOADING {Math.round(progress).toString().padStart(2, '0')}%
            </span>
        </div>
    </div>
  );
};

const App: React.FC = () => {
  // --- 状态管理 ---
  const [treeState, setTreeState] = useState<TreeState>(TreeState.CHAOS);
  const [zoomFactor, setZoomFactor] = useState(0.5); 
  const [userTextureUrls, setUserTextureUrls] = useState<string[]>([]);
  const [isPhotoFocused, setIsPhotoFocused] = useState(false);
  const [isLoadingGift, setIsLoadingGift] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  
  const handRotationVelocity = useRef(0);

  // --- 核心：直接使用 Supabase 加载礼赠 ---
  useEffect(() => {
    const fetchGift = async () => {
        // 1. 获取 URL 参数
        const params = new URLSearchParams(window.location.search);
        const giftId = params.get('id');

        if (!giftId) return;

        setIsLoadingGift(true);
        console.log("Detect Gift ID:", giftId);

        try {
            // 2. 直接查询 Supabase
            const { data, error } = await supabase
                .from('gifts')
                .select('photo_urls')
                .eq('custom_id', giftId)
                .single();

            if (error) {
                console.error("Supabase error:", error);
                throw error; 
            }

            if (data && data.photo_urls && Array.isArray(data.photo_urls)) {
                console.log("Gift loaded successfully:", data.photo_urls.length, "photos");
                setUserTextureUrls(data.photo_urls);
                setTreeState(TreeState.FORMED); // 强制树成型
            } else {
                console.warn("Gift found but no photos attached");
            }
        } catch (err) {
            console.error("Failed to load gift:", err);
        } finally {
            setIsLoadingGift(false);
        }
    };

    fetchGift();
  }, []);

  // 手势控制状态变化
  const handleStateChangeFromHand = (newState: TreeState) => {
    if (isPhotoFocused) return;
    setTreeState(newState);
  };

  // 本地上传处理
  const handleUpload = (files: FileList) => {
    const urls: string[] = [];
    Array.from(files).forEach(file => {
      urls.push(URL.createObjectURL(file));
    });
    setUserTextureUrls(prev => [...prev, ...urls]);
  };

  const handleGenerate = () => {
    setTreeState(TreeState.FORMED);
  };

  const dummyToggle = () => {}; 

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden touch-none">
      
      {/* 1. 开场动画 */}
      {showIntro && <IntroLoader onComplete={() => setShowIntro(false)} />}

      {/* 2. 背景文字 */}
      <BackgroundHeader />

      {/* 3. 礼赠加载提示 */}
      {isLoadingGift && (
         <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 text-[#FFD700] bg-black/60 px-6 py-2 rounded-full border border-[#FFD700]/30 backdrop-blur-md font-serif text-xs tracking-widest animate-pulse shadow-[0_0_20px_rgba(255,215,0,0.2)]">
            OPENING GIFT...
         </div>
      )}

      {/* 4. 3D 场景 */}
      <div className="absolute inset-0 z-10">
          <Canvas 
            dpr={[1, 1.5]} 
            gl={{ 
              antialias: true, 
              toneMappingExposure: 1.2, 
              alpha: true,
              powerPreference: "high-performance",
            }}
          >
            <fog attach="fog" args={['#000000', 30, 90]} />

            <PerspectiveCamera makeDefault position={[0, 4, 25]} fov={45} />
            <CameraRig zoomFactor={zoomFactor} />

            <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#222222" />
            <ambientLight intensity={0.2} />
            
            <spotLight 
                position={[20, 40, 20]} 
                angle={0.4} 
                penumbra={1} 
                intensity={150} 
                color="#fff5d7" 
                castShadow 
            />
            
            <Suspense fallback={null}>
                <Environment
                  files="https://walabox-assets.oss-cn-beijing.aliyuncs.com/potsdamer_platz_1k.hdr"
                  background={false}
                />
            </Suspense>

            <AmbientParticles />
            <GoldDust treeState={treeState} />
            <GoldenSpirals treeState={treeState} />
            
            <Suspense fallback={null}>
                <GroundRipples treeState={treeState} />
                <LuxuryTree 
                  treeState={treeState} 
                  extraRotationVelocity={handRotationVelocity}
                  userTextureUrls={userTextureUrls}
                  isPhotoFocused={isPhotoFocused}
                  zoomFactor={zoomFactor}
                />
            </Suspense>

            <EffectComposer enableNormalPass={false} multisampling={4}>
                <Bloom 
                    luminanceThreshold={1.0} 
                    mipmapBlur 
                    intensity={1.2} 
                    radius={0.4}
                />
                <Vignette eskil={false} offset={0.1} darkness={0.8} />
            </EffectComposer>
          </Canvas>
      </div>

      {/* 5. UI 覆盖层 (HandController 作为 children 传入) */}
      <Overlay 
        currentState={treeState} 
        onToggle={dummyToggle} 
        onUpload={handleUpload}
        onGenerate={handleGenerate}
        userTextureUrls={userTextureUrls}
      >
        {/* --- 修正：HandController 放在 Overlay 内部 --- */}
        <HandController 
          onStateChange={handleStateChangeFromHand}
          onZoomChange={(z) => {
              if (!isPhotoFocused) setZoomFactor(z);
          }}
          onRotateChange={(v) => {
            if (!isPhotoFocused) {
                handRotationVelocity.current = v;
            } else {
                handRotationVelocity.current = 0;
            }
          }}
          onPhotoFocusChange={setIsPhotoFocused}
        />
      </Overlay>
    </div>
  );
};

export default App;