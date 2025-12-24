import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils, NormalizedLandmark } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { TreeState } from '../types';

interface HandControllerProps {
  onStateChange: (state: TreeState) => void;
  onZoomChange: (factor: number) => void;
  onRotateChange: (velocity: number) => void;
  onPhotoFocusChange: (isFocused: boolean) => void;
}

// --- Configuration ---
const DETECTION_INTERVAL = 25; // 提高检测频率以获得更好的响应速度

// Interaction Physics
const ROTATION_SENSITIVITY = 12.0; 
const INERTIA_DECAY = 0.90;      
const ZOOM_SENSITIVITY = 6.0;

// 🟢 阿里云 OSS 资源根目录
// MediaPipe 会自动在此目录下查找 .js, .wasm, 以及 nosimd 版本文件
const OSS_BASE = "https://walabox-assets.oss-cn-beijing.aliyuncs.com/";

type HandMode = 'IDLE' | 'NAVIGATION' | 'SELECTION_READY' | 'SELECTION_ACTIVE';
type Pose = 'OPEN' | 'FIST' | 'PINCH_3_OPEN' | 'POINTING' | 'CLICK_TRIGGERED' | 'UNKNOWN';

export const HandController: React.FC<HandControllerProps> = (props) => {
  const { onStateChange, onZoomChange, onRotateChange, onPhotoFocusChange } = props;
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debugStatus, setDebugStatus] = useState<string>('Initializing...');
  
  const requestRef = useRef<number>(0);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const lastProcessTimeRef = useRef<number>(0);

  // --- Logic State ---
  const currentMode = useRef<HandMode>('IDLE');
  const previousPose = useRef<Pose>('UNKNOWN');
  
  // Navigation State
  const lastHandCentroid = useRef<{x: number, y: number} | null>(null);
  const lastHandScale = useRef<number | null>(null); 
  const currentRotationVel = useRef(0);
  
  // Zoom State
  const currentZoomFactor = useRef(0.5); 
  
  // Click Persistence State
  const clickFrameCounter = useRef(0);

  useEffect(() => {
    let isActive = true;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;

    const init = async () => {
        try {
            if (!videoRef.current) return;
            
            // 1. 初始化摄像头
            stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: "user", 
                    width: { ideal: 640 }, 
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                }
            });

            if (!isActive) {
                stream?.getTracks().forEach(t => t.stop());
                return;
            }

            videoRef.current.srcObject = stream;
            await new Promise<void>((resolve) => {
                if (!videoRef.current) return resolve();
                videoRef.current.onloadedmetadata = () => resolve();
                if (videoRef.current.readyState >= 1) resolve();
            });

            if (!isActive) return;
            await videoRef.current.play();

            // 2. 加载 WASM 核心文件 (从阿里云 OSS)
            // FilesetResolver 会自动检测设备是否支持 SIMD，
            // 并在 OSS_BASE 目录下自动下载对应的 standard 或 nosimd 文件
            const vision = await FilesetResolver.forVisionTasks(
                OSS_BASE 
            );
            
            if (!isActive) return;

            // 3. 创建 HandLandmarker (加载 hand_landmarker.task 模型)
            landmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: OSS_BASE + "hand_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1, 
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            handLandmarkerRef.current = landmarker;
            setDebugStatus("");
            lastProcessTimeRef.current = performance.now();
            loop();

        } catch (err) {
            console.error("Init Error:", err);
            setDebugStatus("Loading Error"); // 简单提示，避免暴露过多技术细节给用户
        }
    };

    init();

    const loop = () => {
        if (!isActive) return;
        
        // Physics Loop (Inertia)
        if (currentMode.current !== 'NAVIGATION') {
            currentRotationVel.current *= INERTIA_DECAY;
            if (Math.abs(currentRotationVel.current) < 0.001) currentRotationVel.current = 0;
            propsRef.current.onRotateChange(currentRotationVel.current);
        }

        const now = performance.now();
        if (now - lastProcessTimeRef.current >= DETECTION_INTERVAL) {
            if (videoRef.current && videoRef.current.readyState >= 2 && handLandmarkerRef.current) {
                lastProcessTimeRef.current = now;
                detect();
            }
        }
        requestRef.current = requestAnimationFrame(loop);
    };

    return () => {
        isActive = false;
        cancelAnimationFrame(requestRef.current);
        stream?.getTracks().forEach(t => t.stop());
        handLandmarkerRef.current?.close();
    };
  }, []);

  // --- Geometry Helpers ---
  const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);

  const isFingerExtended = (landmarks: NormalizedLandmark[], tipIdx: number, pipIdx: number, wristIdx: number) => {
      const dTip = dist(landmarks[tipIdx], landmarks[wristIdx]);
      const dPip = dist(landmarks[pipIdx], landmarks[wristIdx]);
      return dTip > dPip * 1.15; 
  };

  const isFingerCurled = (landmarks: NormalizedLandmark[], tipIdx: number, pipIdx: number, wristIdx: number) => {
      const dTip = dist(landmarks[tipIdx], landmarks[wristIdx]);
      const dPip = dist(landmarks[pipIdx], landmarks[wristIdx]);
      return dTip < dPip * 1.05; 
  };

  const determinePose = (landmarks: NormalizedLandmark[], scale: number): Pose => {
      const wrist = 0;
      const thumbTip = 4, indexTip = 8, midTip = 12, ringTip = 16, pinkyTip = 20;
      const indexPIP = 6, midPIP = 10, ringPIP = 14, pinkyPIP = 18;

      const indexOut = isFingerExtended(landmarks, indexTip, indexPIP, wrist);
      const midOut = isFingerExtended(landmarks, midTip, midPIP, wrist);
      const ringOut = isFingerExtended(landmarks, ringTip, ringPIP, wrist);
      const pinkyOut = isFingerExtended(landmarks, pinkyTip, pinkyPIP, wrist);
      
      const indexCurled = isFingerCurled(landmarks, indexTip, indexPIP, wrist);
      const midCurled = isFingerCurled(landmarks, midTip, midPIP, wrist);
      const ringCurled = isFingerCurled(landmarks, ringTip, ringPIP, wrist);
      const pinkyCurled = isFingerCurled(landmarks, pinkyTip, pinkyPIP, wrist);

      // 1. PINCH_3_OPEN (Navigation)
      const pinchDist = dist(landmarks[thumbTip], landmarks[indexTip]);
      const isPinch = (pinchDist / scale) < 0.35; 
      if (isPinch && midOut && ringOut && pinkyOut) {
          return 'PINCH_3_OPEN';
      }

      // 2. CLICK DETECTION (Specific to SELECTION_READY state)
      if (indexCurled && midCurled && ringCurled && pinkyCurled) {
          return 'FIST'; 
      }

      // 3. OPEN
      if (indexOut && midOut && ringOut && pinkyOut) {
          return 'OPEN';
      }

      // 4. POINTING (Ready for selection)
      if (indexOut && midCurled && ringCurled && pinkyCurled) {
          return 'POINTING';
      }

      return 'UNKNOWN';
  };

  const detect = () => {
    const landmarker = handLandmarkerRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!landmarker || !video || !canvas) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let result;
    try { result = landmarker.detectForVideo(video, performance.now()); } catch(e) { return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const drawingUtils = new DrawingUtils(ctx);
    
    let mainHand: NormalizedLandmark[] | null = null;
    let maxScale = 0;

    if (result.landmarks && result.landmarks.length > 0) {
        for (const hand of result.landmarks) {
            const s = dist(hand[0], hand[9]);
            if (s > maxScale) {
                maxScale = s;
                mainHand = hand;
            }
        }
    }

    if (!mainHand) {
        handleHandLost();
        drawHUD(ctx, "Scanning...", "IDLE");
        return;
    }

    const color = currentMode.current === 'SELECTION_ACTIVE' ? '#ff3366' : 
                  currentMode.current === 'NAVIGATION' ? '#00ffff' : '#00ff44';
                  
    drawingUtils.drawConnectors(mainHand, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 4 });
    drawingUtils.drawLandmarks(mainHand, { color: '#ffffff', lineWidth: 2, radius: 4 });

    const pose = determinePose(mainHand, maxScale);
    processState(pose, mainHand, maxScale, ctx);

    drawHUD(ctx, `Mode: ${currentMode.current}`, pose);
  };

  const processState = (pose: Pose, landmarks: NormalizedLandmark[], scale: number, ctx: CanvasRenderingContext2D) => {
    const { onStateChange, onPhotoFocusChange, onRotateChange, onZoomChange } = propsRef.current;
    
    // NAVIGATION
    if (pose === 'PINCH_3_OPEN') {
        currentMode.current = 'NAVIGATION';
        const pinchX = (landmarks[4].x + landmarks[8].x) / 2;
        const pinchY = (landmarks[4].y + landmarks[8].y) / 2;
        if (lastHandCentroid.current) {
            const dx = pinchX - lastHandCentroid.current.x;
            if (Math.abs(dx) > 0.001) {
                currentRotationVel.current = -dx * ROTATION_SENSITIVITY;
                onRotateChange(currentRotationVel.current);
            }
        }
        lastHandCentroid.current = { x: pinchX, y: pinchY };
        if (lastHandScale.current !== null) {
            const dScale = scale - lastHandScale.current;
            let newZoom = currentZoomFactor.current + dScale * ZOOM_SENSITIVITY;
            newZoom = Math.max(0, Math.min(1, newZoom));
            currentZoomFactor.current = newZoom;
            onZoomChange(newZoom);
        }
        lastHandScale.current = scale;
        onPhotoFocusChange(false);
        previousPose.current = pose;
        return;
    } else {
        if (currentMode.current === 'NAVIGATION') {
            lastHandCentroid.current = null;
            lastHandScale.current = null; 
            currentMode.current = 'IDLE';
        }
    }

    // SELECTION (The sensitive click logic)
    if (pose === 'POINTING') {
        if (currentMode.current !== 'SELECTION_ACTIVE') {
            currentMode.current = 'SELECTION_READY';
            onPhotoFocusChange(false);
        } else {
            currentMode.current = 'IDLE';
            onPhotoFocusChange(false);
        }
    } else if (pose === 'FIST') {
        if (currentMode.current === 'SELECTION_READY' || currentMode.current === 'SELECTION_ACTIVE') {
            clickFrameCounter.current++;
            if (clickFrameCounter.current > 1) {
                currentMode.current = 'SELECTION_ACTIVE';
                onPhotoFocusChange(true);
                const tip = landmarks[8];
                ctx.beginPath();
                ctx.arc(tip.x * ctx.canvas.width, tip.y * ctx.canvas.height, 20, 0, Math.PI*2);
                ctx.fillStyle = '#ff3366'; ctx.fill();
            }
        } else {
            if (previousPose.current === 'OPEN') {
                onStateChange(TreeState.FORMED);
            }
            currentMode.current = 'IDLE';
        }
    } else if (pose === 'OPEN') {
        clickFrameCounter.current = 0;
        if (previousPose.current === 'FIST' && currentMode.current === 'IDLE') {
            onStateChange(TreeState.CHAOS);
        }
        currentMode.current = 'IDLE';
        onPhotoFocusChange(false);
    } else {
        if (currentMode.current !== 'SELECTION_ACTIVE') {
            currentMode.current = 'IDLE';
            clickFrameCounter.current = 0;
        }
    }

    previousPose.current = pose;
  };

  const handleHandLost = () => {
      if (currentMode.current === 'SELECTION_ACTIVE') {
          propsRef.current.onPhotoFocusChange(false);
      }
      currentMode.current = 'IDLE';
      lastHandCentroid.current = null;
      lastHandScale.current = null;
      clickFrameCounter.current = 0;
  };

  const drawHUD = (ctx: CanvasRenderingContext2D, text: string, subText: string) => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.roundRect(10, 10, 220, 50, 8);
      ctx.fill();
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 14px 'Courier New'";
      ctx.fillText(text, 20, 30);
      ctx.fillStyle = "#cccccc";
      ctx.font = "12px 'Courier New'";
      ctx.fillText(subText, 20, 48);
  };

  return (
    // 1. 定位容器：固定在右下角 (bottom-4 right-4)，层级最高 (z-50)，固定大小 (w-64 h-48)
    <div className="hand-tracker-container fixed bottom-0 right-0 z-50 w-64 h-48 rounded-xl overflow-hidden border-0 border-[#FFD700]/50 shadow-[0_0_20px_rgba(255,215,0,0.3)] bg-black/80 pointer-events-auto">
      
      {/* 2. 视频层：充满容器 (absolute inset-0)，镜像翻转 (-scale-x-100) */}
      <video 
        ref={videoRef} 
        id="webcam-video" 
        autoPlay 
        playsInline 
        muted 
        className="absolute inset-0 w-full h-full object-cover -scale-x-100 opacity-60" 
      />
      
      {/* 3. 绘图层：必须覆盖在视频之上，同样镜像翻转 */}
      <canvas 
        ref={canvasRef} 
        id="webcam-canvas" 
        className="absolute inset-0 w-full h-full object-cover -scale-x-100" 
      />
      
      {/* 4. 状态标签（可选）：显示当前控制是否激活 */}
      <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[10px] font-mono text-[#FFD700] backdrop-blur-sm border border-[#FFD700]/20">
        AI VISION
      </div>
    </div>
  );
};