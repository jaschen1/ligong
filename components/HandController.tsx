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
const GESTURE_CONFIRM_FRAMES = 2; // 降低一点帧数，让点击反应更快

// Physics
const ROTATION_SENSITIVITY = 12.0; 
const INERTIA_DECAY = 0.90;      
const ZOOM_SENSITIVITY = 6.0;

const OSS_BASE = "https://walabox-assets.oss-cn-beijing.aliyuncs.com/";

type HandMode = 'IDLE' | 'NAVIGATION'; 
type Pose = 'OPEN' | 'FIST' | 'PINCH' | 'POINTING' | 'UNKNOWN';

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
  const gestureFrameCounter = useRef(0);
  const lastStablePose = useRef<Pose>('UNKNOWN');
  
  // Navigation State
  const lastHandCentroid = useRef<{x: number, y: number} | null>(null);
  const lastHandScale = useRef<number | null>(null); 
  const currentRotationVel = useRef(0);
  const currentZoomFactor = useRef(0.5); 

  // 📸 点击逻辑状态
  // 用于记录上一帧是否是“食指指点”状态，这是点击动作的必经之路
  const wasPointing = useRef(false); 
  const isPhotoFocusedLocal = useRef(false);

  useEffect(() => {
    let isActive = true;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;

    const init = async () => {
        try {
            if (!videoRef.current) return;
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
            });
            if (!isActive) { stream?.getTracks().forEach(t => t.stop()); return; }

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
                baseOptions: { modelAssetPath: OSS_BASE + "hand_landmarker.task", delegate: "GPU" },
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

      // --- 1. PINCH (Navigation) [最高优先级] ---
      // 关键修正：只要大拇指和食指捏合，就判定为 PINCH。
      // 不再强制要求其他三指伸直。这样用户从握拳变为捏合时，即使其他手指还弯着，也会优先识别为捏合，避免误触“张手扩散”。
      const pinchDist = dist(landmarks[thumbTip], landmarks[indexTip]);
      const isPinch = (pinchDist / scale) < 0.35; 
      
      if (isPinch) {
          return 'PINCH';
      }

      // --- 2. POINTING (食指伸直，其他弯曲) ---
      // 这是点击的“预备动作”
      if (indexOut && midCurled && ringCurled && pinkyCurled) {
          return 'POINTING';
      }

      // --- 3. FIST (握拳) ---
      // 聚合树 / 点击的“完成动作”
      if (indexCurled && midCurled && ringCurled && pinkyCurled) {
          return 'FIST'; 
      }

      // --- 4. OPEN (张手) ---
      // 严格判定：必须四个手指都伸直才算扩散。防止由于误操作触发散开。
      if (indexOut && midOut && ringOut && pinkyOut) {
          return 'OPEN';
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

    const color = currentMode.current === 'NAVIGATION' ? '#00ffff' : '#00ff44';
    drawingUtils.drawConnectors(mainHand, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 4 });
    drawingUtils.drawLandmarks(mainHand, { color: '#ffffff', lineWidth: 2, radius: 4 });

    const pose = determinePose(mainHand, maxScale);
    processState(pose, mainHand, maxScale, ctx, mainHand); // 传入 mainHand 以便绘制反馈

    // 调试信息
    let statusText = `Mode: ${currentMode.current}`;
    if (pose === 'POINTING') statusText = "Action: READY (Bend to Click)";
    if (pose === 'PINCH') statusText = "Action: DRAGGING";
    drawHUD(ctx, statusText, pose);
  };

  const processState = (pose: Pose, landmarks: NormalizedLandmark[], scale: number, ctx: CanvasRenderingContext2D, hand: NormalizedLandmark[]) => {
    const { onStateChange, onPhotoFocusChange, onRotateChange, onZoomChange } = propsRef.current;
    
    // --- 去抖动 ---
    if (pose !== lastStablePose.current) {
        gestureFrameCounter.current++;
        if (gestureFrameCounter.current >= GESTURE_CONFIRM_FRAMES) {
            lastStablePose.current = pose;
            gestureFrameCounter.current = 0;
        }
    } else {
        gestureFrameCounter.current = 0;
    }

    // PINCH 拥有最高优先级，绕过去抖动，保证拖拽跟手
    const activePose = (pose === 'PINCH') ? pose : lastStablePose.current;

    // --- 1. Navigation (Pinch) ---
    // 解决了“误触发扩散”的问题：只要捏合，立刻进入导航，不再等待张手
    if (activePose === 'PINCH') {
        currentMode.current = 'NAVIGATION';
        // 重置点击预备状态，防止误触
        wasPointing.current = false; 

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
        
        // 拖拽时暂时不取消照片锁定，看用户需求，如果需要取消可以解开下面注释
        // if (isPhotoFocusedLocal.current) { ... }
        return;
    } else {
        if (currentMode.current === 'NAVIGATION') {
            lastHandCentroid.current = null;
            lastHandScale.current = null; 
            currentMode.current = 'IDLE';
        }
    }

    // --- 2. CLICK LOGIC (Index Bend) ---
    // 逻辑：只有当上一刻是 POINTING，这一刻变成 FIST，才算点击。
    
    if (activePose === 'POINTING') {
        wasPointing.current = true; // 标记：用户已经伸出食指，准备点击
        currentMode.current = 'IDLE';
        return;
    }

    if (activePose === 'FIST') {
        if (wasPointing.current) {
            // [触发点击]：检测到从“指点”变成了“握拳”
            // 这是一个明确的弯曲食指动作
            isPhotoFocusedLocal.current = !isPhotoFocusedLocal.current;
            onPhotoFocusChange(isPhotoFocusedLocal.current);
            
            // 视觉反馈：在指尖画个圈
            const tip = hand[8];
            ctx.beginPath();
            ctx.arc(tip.x * ctx.canvas.width, tip.y * ctx.canvas.height, 20, 0, Math.PI*2);
            ctx.fillStyle = '#FFD700';
            ctx.fill();

            // 消耗掉这个状态，防止连续触发
            wasPointing.current = false; 
        } else {
            // [触发聚合]：直接检测到握拳，且没有之前的指点动作
            // 这意味着用户就是想聚合树，或者点击动作已经结束
            onStateChange(TreeState.FORMED);
            
            // 聚合树时，通常我们也希望关闭照片预览
            if (isPhotoFocusedLocal.current) {
                isPhotoFocusedLocal.current = false;
                onPhotoFocusChange(false);
            }
        }
        currentMode.current = 'IDLE';
        return;
    }

    // --- 3. DISPERSE (Open) ---
    if (activePose === 'OPEN') {
        onStateChange(TreeState.CHAOS);
        
        wasPointing.current = false; // 重置点击状态
        
        // 张手散开时，关闭照片
        if (isPhotoFocusedLocal.current) {
            isPhotoFocusedLocal.current = false;
            onPhotoFocusChange(false);
        }
        currentMode.current = 'IDLE';
    }
  };

  const handleHandLost = () => {
      propsRef.current.onPhotoFocusChange(false);
      isPhotoFocusedLocal.current = false;
      wasPointing.current = false;
      currentMode.current = 'IDLE';
      lastHandCentroid.current = null;
      lastHandScale.current = null;
  };

  const drawHUD = (ctx: CanvasRenderingContext2D, text: string, subText: string) => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.roundRect(10, 10, 240, 55, 12);
      ctx.fill();
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 14px 'Courier New'";
      ctx.fillText(text, 20, 30);
      ctx.fillStyle = "#cccccc";
      ctx.font = "12px 'Courier New'";
      ctx.fillText(subText, 20, 48);
  };

  return (
    <div className="hand-tracker-container">
      <video ref={videoRef} id="webcam-video" autoPlay playsInline muted />
      <canvas ref={canvasRef} id="webcam-canvas" />
    </div>
  );
};