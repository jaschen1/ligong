import React, { useState, useEffect } from 'react';

export const BackgroundHeader: React.FC = () => {
  // 初始化状态时，直接从 URL 获取 id 参数
  const [recipientName, setRecipientName] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || "";
  });

  // 标记是否为只读模式（如果有ID，说明是接收者视图）
  const isRecipientView = !!(new URLSearchParams(window.location.search).get('id'));

  return (
    <div className="absolute inset-0 flex flex-col items-center pt-8 md:pt-6 pointer-events-none z-50">
      <style>{`
        @keyframes subtleFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(8px); }
        }
        @keyframes glowPulse {
          0%, 100% { text-shadow: 0 0 8px rgba(170, 119, 28, 0.4), 0 0 16px rgba(212, 175, 55, 0.15); }
          50% { text-shadow: 0 0 16px rgba(255, 215, 0, 0.7), 0 0 28px rgba(255, 223, 0, 0.35); }
        }
      `}</style>
      
      <div 
        className="flex flex-col items-end px-4"
        style={{ animation: 'subtleFloat 6s ease-in-out infinite' }}
      >
        {/* Title */}
        <h1 
            className="text-4xl md:text-7xl tracking-wider leading-none" 
            style={{
                fontFamily: '"Great Vibes", cursive', // 注意：如果未引入该字体，请回退到你在上一段代码中使用的 font-handwriting 类
                color: '#fff5d7',
                background: 'linear-gradient(180deg, #FFFFFF 0%, #FFD700 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                animation: 'glowPulse 4s ease-in-out infinite',
                padding: '0.1em 0',
            }}
        >
          Merry Christmas
        </h1>
        
        {/* Especially for section */}
        <div className="flex flex-row items-center gap-1 md:gap-2 pointer-events-auto">
            <span className="text-white text-xs md:text-base italic tracking-widest font-serif whitespace-nowrap drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] opacity-90">
                Especially for
            </span>
            <input 
                type="text" 
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="[Name]"
                readOnly={isRecipientView} // 如果是专属链接，建议设为只读，防止误触
                className={`
                  bg-transparent focus:outline-none w-24 md:w-36 transition-colors placeholder-white/30 text-left
                  ${isRecipientView ? 'cursor-default' : 'cursor-text'} 
                `}
                style={{ 
                    fontFamily: '"Great Vibes", cursive',
                    fontSize: '1.5rem', 
                    lineHeight: '1', 
                    color: '#FFD700', 
                    textShadow: recipientName ? '0 0 10px rgba(255, 215, 0, 0.8)' : '0 2px 4px rgba(0,0,0,0.8)',
                    transform: 'translateY(1px)' 
                }}
            />
        </div>
      </div>
    </div>
  );
};