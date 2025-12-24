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
const OSS_BASE = "https://walabox-assets.oss-cn-beijing.aliyuncs.com/";

// Removing 'SELECTION_READY' | 'SELECTION_ACTIVE' from active logic, 
// but keeping types simple to minimize code changes elsewhere if needed.
type HandMode = 'IDLE' | 'NAVIGATION'; 
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
  
  // Zoom State
  const currentZoomFactor = useRef(0.5); 

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
            const vision = await FilesetResolver.forVisionTasks(
                OSS_BASE 
            );
            
            if (!isActive) return;

            // 3. 创建 HandLandmarker
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

      // 2. FIST (Tree Formation)
      if (indexCurled && midCurled && ringCurled && pinkyCurled) {
          return 'FIST'; 
      }

      // 3. OPEN (Tree Chaos)
      if (indexOut && midOut && ringOut && pinkyOut) {
          return 'OPEN';
      }

      // 4. POINTING (Just detection, no action)
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

    const color = currentMode.current === 'NAVIGATION' ? '#00ffff' : '#00ff44';
                  
    drawingUtils.drawConnectors(mainHand, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 4 });
    drawingUtils.drawLandmarks(mainHand, { color: '#ffffff', lineWidth: 2, radius: 4 });

    const pose = determinePose(mainHand, maxScale);
    processState(pose, mainHand, maxScale, ctx);

    drawHUD(ctx, `Mode: ${currentMode.current}`, pose);
  };

  const processState = (pose: Pose, landmarks: NormalizedLandmark[], scale: number, ctx: CanvasRenderingContext2D) => {
    const { onStateChange, onPhotoFocusChange, onRotateChange, onZoomChange } = propsRef.current;
    
    // --- 1. NAVIGATION (Pinch) ---
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
        // Exit Navigation
        if (currentMode.current === 'NAVIGATION') {
            lastHandCentroid.current = null;
            lastHandScale.current = null; 
            currentMode.current = 'IDLE';
        }
    }

    // --- 2. STATE CONTROL (Fist / Open) ---
    // 删除掉了 POINTING 触发 SELECTION_READY 的逻辑
    // 删除掉了 FIST 触发 SELECTION_ACTIVE 的逻辑，仅保留触发 TreeState

    if (pose === 'FIST') {
        // 如果之前是张开的，现在握拳，则聚合树
        if (previousPose.current === 'OPEN') {
            onStateChange(TreeState.FORMED);
        }
        currentMode.current = 'IDLE';
    } else if (pose === 'OPEN') {
        // 如果之前是握拳，现在张开，则散开树
        if (previousPose.current === 'FIST' && currentMode.current === 'IDLE') {
            onStateChange(TreeState.CHAOS);
        }
        currentMode.current = 'IDLE';
        onPhotoFocusChange(false);
    } else {
        // 其他姿势 (包括 POINTING) 重置为 IDLE
        currentMode.current = 'IDLE';
    }

    previousPose.current = pose;
  };

  const handleHandLost = () => {
      // 确保手丢失时重置状态
      propsRef.current.onPhotoFocusChange(false);
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
    <div className="hand-tracker-container">
      <video ref={videoRef} id="webcam-video" autoPlay playsInline muted />
      <canvas ref={canvasRef} id="webcam-canvas" />
    </div>
  );
};