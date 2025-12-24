import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { TreeState } from '../types';

interface HandControllerProps {
  onStateChange: (state: TreeState) => void;
  onZoomChange: (factor: number) => void;
  onRotateChange: (velocity: number) => void;
  onPhotoFocusChange: (isFocused: boolean) => void;
}

// --- Configuration ---
const DETECTION_INTERVAL = 25; 

// Interaction Physics
const ROTATION_SENSITIVITY = 12.0; 
const INERTIA_DECAY = 0.90;      
const ZOOM_SENSITIVITY = 6.0;

const OSS_BASE = "https://walabox-assets.oss-cn-beijing.aliyuncs.com/";

// 状态定义简化：只保留必要的逻辑状态，不再有 "SELECTION_ACTIVE" 这种锁死的状态
type HandMode = 'IDLE' | 'NAVIGATION' | 'SELECTION_READY'; 
type Pose = 'OPEN' | 'FIST' | 'PINCH_3_OPEN' | 'POINTING' | 'UNKNOWN';

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
  const currentZoomFactor = useRef(0.5); 

  useEffect(() => {
    let isActive = true;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;

    const init = async () => {
        try {
            if (!videoRef.current) return;
            
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

            const vision = await FilesetResolver.forVisionTasks(OSS_BASE);
            if (!isActive) return;

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
            setDebugStatus("Loading Error");
        }
    };

    init();

    const loop = () => {
        if (!isActive) return;
        
        // 惯性处理
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

  // --- Geometry Helpers (保持高灵敏度) ---
  const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);

  const isFingerExtended = (landmarks: NormalizedLandmark[], tipIdx: number, pipIdx: number, wristIdx: number) => {
      const dTip = dist(landmarks[tipIdx], landmarks[wristIdx]);
      const dPip = dist(landmarks[pipIdx], landmarks[wristIdx]);
      // 保持 1.05 的高灵敏度，容易识别张开
      return dTip > dPip * 1.05; 
  };

  const isFingerCurled = (landmarks: NormalizedLandmark[], tipIdx: number, pipIdx: number, wristIdx: number) => {
      const dTip = dist(landmarks[tipIdx], landmarks[wristIdx]);
      const dPip = dist(landmarks[pipIdx], landmarks[wristIdx]);
      // 保持 1.3 的高灵敏度，容易识别握拳
      return dTip < dPip * 1.3; 
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

      // 1. PINCH (导航) - 优先级最高
      const pinchDist = dist(landmarks[thumbTip], landmarks[indexTip]);
      const isPinch = (pinchDist / scale) < 0.35; 
      if (isPinch && midOut && ringOut && pinkyOut) {
          return 'PINCH_3_OPEN';
      }

      // 2. FIST (点击 或 聚拢)
      if (indexCurled && midCurled && ringCurled && pinkyCurled) {
          return 'FIST'; 
      }

      // 3. OPEN (打散)
      if (indexOut && midOut && ringOut && pinkyOut) {
          return 'OPEN';
      }

      // 4. POINTING (准备点击/选中) - 恢复这个状态
      // 食指伸直，其他手指弯曲
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

    // HUD 颜色逻辑
    let color = '#00ff44'; // 默认绿
    if (currentMode.current === 'NAVIGATION') color = '#00ffff'; // 导航青
    else if (currentMode.current === 'SELECTION_READY') color = '#ff00ff'; // 准备点击紫
    
    drawingUtils.drawConnectors(mainHand, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 4 });
    drawingUtils.drawLandmarks(mainHand, { color: '#ffffff', lineWidth: 2, radius: 4 });

    const pose = determinePose(mainHand, maxScale);
    processState(pose, mainHand, maxScale, ctx);

    drawHUD(ctx, `Mode: ${currentMode.current}`, pose);
  };

  const processState = (pose: Pose, landmarks: NormalizedLandmark[], scale: number, ctx: CanvasRenderingContext2D) => {
    const { onStateChange, onPhotoFocusChange, onRotateChange, onZoomChange } = propsRef.current;
    
    // === 1. 导航模式 (绝对优先，随时打断) ===
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
        
        // 导航时我们不强制关闭 Focus，允许用户在 Focus 状态下旋转
        // 除非用户逻辑希望旋转即退出 Focus，这里保持“不屏蔽”原则
        
        previousPose.current = pose;
        return; // 导航期间跳过其他逻辑
    } 
    
    // 退出导航逻辑
    if (currentMode.current === 'NAVIGATION') {
        lastHandCentroid.current = null;
        lastHandScale.current = null; 
        currentMode.current = 'IDLE'; 
    }

    // === 2. 状态判断 (区分 点击照片 和 聚拢树) ===
    
    // 如果之前状态完全一致，跳过处理（防止连续触发）
    // 但 POINTING 需要持续刷新 Mode
    if (pose === previousPose.current) {
        if (pose === 'POINTING') {
            currentMode.current = 'SELECTION_READY';
        }
        return;
    }

    // --- Pose Changed Logic ---

    if (pose === 'POINTING') {
        // 进入“准备点击”状态
        currentMode.current = 'SELECTION_READY';
        // 视觉提示：可以在这里加光标，目前只改 Mode
    } 
    else if (pose === 'FIST') {
        // 关键逻辑：判断这个拳头是“点击”还是“聚拢”？
        
        if (previousPose.current === 'POINTING' || currentMode.current === 'SELECTION_READY') {
            // 场景 A: 之前在指，现在握拳 -> 点击 (Select Photo)
            console.log("Action: CLICK (Select Photo)");
            onPhotoFocusChange(true);
            
            // 触发后立即回到 IDLE，不锁定！
            // 这样下一帧如果变成 OPEN，就能立刻打散；变成 PINCH 就能立刻旋转
            currentMode.current = 'IDLE'; 
        } else {
            // 场景 B: 之前是张开或待机，现在握拳 -> 聚拢 (Form Tree)
            console.log("Action: GATHER (Form Tree)");
            onStateChange(TreeState.FORMED);
            
            // 聚拢树的时候，通常意味着要退出照片查看
            onPhotoFocusChange(false);
            currentMode.current = 'IDLE';
        }
    } 
    else if (pose === 'OPEN') {
        // 张开手 -> 扩散 (Chaos)
        console.log("Action: SCATTER (Chaos)");
        onStateChange(TreeState.CHAOS);
        
        // 打散粒子肯定要退出照片查看
        onPhotoFocusChange(false);
        currentMode.current = 'IDLE';
    }
    else {
        // UNKNOWN
        currentMode.current = 'IDLE';
    }
    
    previousPose.current = pose;
  };

  const handleHandLost = () => {
      currentMode.current = 'IDLE';
      lastHandCentroid.current = null;
      lastHandScale.current = null;
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
    <div className="hand-tracker-container fixed bottom-1 right-0 z-50 w-64 h-48 rounded-xl overflow-hidden border-2 border-[#FFD700]/50 shadow-[0_0_20px_rgba(255,215,0,0.3)] bg-black/80 pointer-events-auto">
      
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