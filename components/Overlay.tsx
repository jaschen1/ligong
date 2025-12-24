import React, { useRef, useState, useEffect } from 'react';
import { TreeState } from '../types';
import { GiftLinkGenerator } from './GiftLinkGenerator'; 

interface OverlayProps {
  currentState: TreeState;
  onToggle: () => void;
  onUpload: (files: FileList) => void;
  onGenerate: () => void;
  userTextureUrls?: string[];
  children?: React.ReactNode; 
}

export const Overlay: React.FC<OverlayProps> = ({ 
  currentState, 
  onToggle, 
  onUpload, 
  onGenerate, 
  userTextureUrls = [],
  children 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileCount, setFileCount] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);
  const [showGiftGenerator, setShowGiftGenerator] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowInstructions(false);
    }, 6000);
    return () => clearTimeout(timer);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFileCount(e.target.files.length);
      onUpload(e.target.files);
      onGenerate();
      setIsSubmitted(true);
      e.target.value = ''; 
    }
  };

  // 奢华液态玻璃样式
  const liquidGlassStyle = {
    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03))',
    backdropFilter: 'blur(16px) saturate(180%)',
    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    boxShadow: '0 8px 32px -4px rgba(0, 0, 0, 0.3)',
  };

  return (
    <>
      {/* --- 全局 UI 容器 (禁止拦截点击) --- */}
      <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden font-serif">
        
        {/* --- 1. 左下角：统一控制区 (开启点击) --- */}
        <div 
          className="absolute left-6 bottom-32 md:left-8 md:bottom-44 pointer-events-auto z-50 flex flex-col gap-0.5"
          style={{ 
            width: 'min(120px, 42vw)',
            paddingBottom: 'env(safe-area-inset-bottom)' 
          }}
        >
          {/* [修改说明]:
             1. 删除了原本的 Control 1 (切换按钮)
             2. className 中 bottom-24 改为 bottom-32, md:bottom-32 改为 md:bottom-40 (整体上移)
             3. className 中 gap-3 改为 gap-2 (间距变小)
          */}

          {/* 控件 2: 分享礼赠按钮 */}
          <button
            onClick={() => setShowGiftGenerator(true)}
            className="group relative w-full py-2.5 text-[#FFD700] font-bold text-[10px] md:text-xs tracking-widest uppercase transition-all duration-300 hover:scale-105 active:scale-95 flex justify-center items-center gap-2"
            style={{ ...liquidGlassStyle, borderRadius: '12px' }}
          >
            <span className="relative z-10 drop-shadow-md">🎁 分享礼赠</span>
            <div className="absolute inset-0 rounded-[12px] opacity-0 group-hover:opacity-100 transition-opacity duration-700"
              style={{ background: 'linear-gradient(45deg, transparent, rgba(255,255,255,0.15), transparent)' }}
            />
          </button>

          {/* 控件 3: 上传照片预览按钮 */}
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" multiple className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-2.5 text-[#FFD700] font-bold text-[10px] md:text-xs tracking-tight transition-all duration-300 flex flex-col items-center hover:scale-105 active:scale-95"
            style={{ ...liquidGlassStyle, borderRadius: '12px' }}
          >
            <span className="font-serif italic text-center" style={{ fontFamily: '"Playfair Display", serif' }}>
              {isSubmitted ? `✨ 已添加 ${fileCount} 张` : "上传照片预览"}
            </span>
          </button>
        </div>

        {/* --- 2. 右下角：手势指南 (保持独立) --- */}
        <div 
          className="absolute right-6 bottom-10 md:right-10 md:bottom-12 pointer-events-auto z-40 flex flex-col items-end"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div 
            className={`
              w-[135px] md:w-[170px] p-4 text-white/90
              transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]
              origin-bottom-right
              ${showInstructions ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-75 translate-y-12 pointer-events-none'}
            `}
            style={{ ...liquidGlassStyle, borderRadius: '24px' }}
          >
            <div className="flex justify-between items-center mb-3 border-b border-white/10 pb-2">
              <h3 className="text-[9px] font-bold tracking-widest text-[#FFD700] opacity-80 uppercase">Gestures</h3>
              <button onClick={() => setShowInstructions(false)} className="text-[10px] opacity-40 hover:opacity-100">✕</button>
            </div>
            
            <ul className="space-y-3">
              {[
                { icon: '✊', label: '握拳', sub: '聚合圣诞树' },
                { icon: '👐', label: '张手', sub: '扩散圣诞树' },
                { icon: '👌', label: '捏合', sub: '缩放旋转' },
                { icon: '☝️', label: '指尖', sub: '选中照片' }
              ].map((item, idx) => (
                <li key={idx} className="flex items-center gap-3">
                  <span className="text-lg md:text-xl drop-shadow-md">{item.icon}</span>
                  <div className="flex flex-col leading-none">
                    <strong className="text-[9px] uppercase tracking-tighter text-white/90 italic">{item.label}</strong>
                    <span className="text-[7px] text-white/30 mt-0.5">{item.sub}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {!showInstructions && (
            <button 
              onClick={() => setShowInstructions(true)}
              className="w-11 h-11 md:w-13 md:h-13 flex items-center justify-center text-[#FFD700] transition-all duration-300 hover:scale-110 active:scale-90"
              style={{ ...liquidGlassStyle, borderRadius: '50%' }}
            >
              <span className="italic text-lg">?</span>
            </button>
          )}
        </div>
      </div>

      {/* --- 3. 全屏礼赠生成器弹窗 --- */}
      {showGiftGenerator && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl transition-opacity duration-700" onClick={() => setShowGiftGenerator(false)} />
          <div className="relative w-full max-w-sm transform animate-in zoom-in-95 fade-in duration-500 ease-out">
            <button 
              onClick={() => setShowGiftGenerator(false)}
              className="absolute -top-10 right-0 text-[#FFD700]/60 hover:text-white text-[10px] tracking-[0.4em] font-serif italic"
            >
              CLOSE [ESC]
            </button>
            <div className="overflow-hidden shadow-2xl" style={{ borderRadius: '28px' }}>
                <GiftLinkGenerator onSuccess={(id) => {
                  console.log("Gift created:", id);
                  // setShowGiftGenerator(false); 
                }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
};