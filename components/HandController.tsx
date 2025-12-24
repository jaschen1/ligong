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
const DETECTION_INTERVAL = 25; 
const GESTURE_CONFIRM_FRAMES = 3; 

// Physics
const ROTATION_SENSITIVITY = 12.0; 
const INERTIA_DECAY = 0.90;      
const ZOOM_SENSITIVITY = 6.0;

const OSS_BASE = "https://walabox-assets.oss-cn-beijing.aliyuncs.com/";

type HandMode = 'IDLE' | 'NAVIGATION'; 
// 新增 POINTING 状态用于检测点击前摇
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
  const gestureFrameCounter = useRef(0);
  const lastStablePose = useRef<Pose>('UNKNOWN');
  
  // Navigation State
  const lastHandCentroid = useRef<{x: number, y: number} | null>(null);
  const lastHandScale = useRef<number | null>(null); 
  const currentRotationVel = useRef(0);
  const currentZoomFactor = useRef(0.5); 

  // 📸 点击/锁定逻辑状态核心
  const isClickReady = useRef(false); // 是否已“上膛”（检测到了食指伸直）
  const isPhotoFocusedLocal = useRef(false); // 本地记录当前是否处于放大状态

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

      // 1. PINCH (Navigation)
      const pinchDist = dist(landmarks[thumbTip], landmarks[indexTip]);
      const isPinch = (pinchDist / scale) < 0.35; 
      if (isPinch && midOut && ringOut && pinkyOut) {
          return 'PINCH_3_OPEN';
      }

      // 2. POINTING (☝️ 食指伸直，其他卷曲)
      // 这是点击动作的“前摇”
      if (indexOut && midCurled && ringCurled && pinkyCurled) {
          return 'POINTING';
      }

      // 3. FIST (✊ 握拳)
      // 既可以是树的聚合，也可以是点击动作的“收尾”
      if (indexCurled && midCurled && ringCurled && pinkyCurled) {
          return 'FIST'; 
      }

      // 4. OPEN (🖐 张手)
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
    processState(pose, mainHand, maxScale, ctx);

    // 动态显示当前状态，方便调试
    let statusText = `Mode: ${currentMode.current}`;
    if (pose === 'POINTING') statusText = "Mode: READY TO CLICK";
    drawHUD(ctx, statusText, pose);
  };

  const processState = (pose: Pose, landmarks: NormalizedLandmark[], scale: number, ctx: CanvasRenderingContext2D) => {
    const { onStateChange, onPhotoFocusChange, onRotateChange, onZoomChange } = propsRef.current;
    
    // --- 去抖动逻辑 ---
    if (pose !== lastStablePose.current) {
        gestureFrameCounter.current++;
        if (gestureFrameCounter.current >= GESTURE_CONFIRM_FRAMES) {
            lastStablePose.current = pose;
            gestureFrameCounter.current = 0;
        }
    } else {
        gestureFrameCounter.current = 0;
    }

    const activePose = (pose === 'PINCH_3_OPEN') ? pose : lastStablePose.current;

    // --- 1. Navigation (Pinch) ---
    if (activePose === 'PINCH_3_OPEN') {
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
        // 捏合时取消锁定状态
        if (isPhotoFocusedLocal.current) {
             isPhotoFocusedLocal.current = false;
             onPhotoFocusChange(false);
        }
        return;
    } else {
        if (currentMode.current === 'NAVIGATION') {
            lastHandCentroid.current = null;
            lastHandScale.current = null; 
            currentMode.current = 'IDLE';
        }
    }

    // --- 2. CLICK LOGIC (Index Straight -> Bent) ---
    
    if (activePose === 'POINTING') {
        // 步骤1：检测到食指伸直，进入“预备点击”状态
        isClickReady.current = true;
        currentMode.current = 'IDLE';
        return;
    }

    if (activePose === 'FIST') {
        if (isClickReady.current) {
            // 步骤2：检测到握拳，且之前是“预备点击”状态 -> 触发点击
            // 这是一个点击动作！拦截树的聚合，改为切换照片焦点
            isPhotoFocusedLocal.current = !isPhotoFocusedLocal.current; // 切换状态
            onPhotoFocusChange(isPhotoFocusedLocal.current);
            
            // 消耗掉这次点击，防止连续触发
            isClickReady.current = false; 
            
            // 可选：绘制一个圆圈提示点击成功
            const tip = landmarks[8];
            ctx.beginPath();
            ctx.arc(tip.x * ctx.canvas.width, tip.y * ctx.canvas.height, 30, 0, Math.PI*2);
            ctx.fillStyle = isPhotoFocusedLocal.current ? 'rgba(255, 50, 100, 0.6)' : 'rgba(100, 255, 100, 0.6)';
            ctx.fill();
        } else {
            // 步骤3：如果是直接握拳（没有预备动作），则执行原本的“聚拢成树”
            onStateChange(TreeState.FORMED);
            // 确保树聚拢时，照片缩回去
            if (isPhotoFocusedLocal.current) {
                isPhotoFocusedLocal.current = false;
                onPhotoFocusChange(false);
            }
        }
        currentMode.current = 'IDLE';
        return;
    }

    if (activePose === 'OPEN') {
        // 重置所有状态
        onStateChange(TreeState.CHAOS);
        isClickReady.current = false;
        
        // 张手时也取消照片锁定
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
      isClickReady.current = false;
      currentMode.current = 'IDLE';
      lastHandCentroid.current = null;
      lastHandScale.current = null;
  };

  const drawHUD = (ctx: CanvasRenderingContext2D, text: string, subText: string) => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.roundRect(10, 10, 240, 55, 8);
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