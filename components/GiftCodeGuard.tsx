import React, { useState } from 'react';
import { supabase } from '../supabaseClient'; // 确保路径正确

interface Props {
  onVerified: () => void;
}

export const GiftCodeGuard: React.FC<Props> = ({ onVerified }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerify = async () => {
    if (!code) return;
    setLoading(true);
    setError('');

    try {
      // 调用 Supabase 的 RPC 函数
      const { data, error: rpcError } = await supabase.rpc('verify_and_use_code', {
        input_code: code.trim().toUpperCase()
      });

      if (rpcError) throw rpcError;

      // data 返回的是我们 SQL 里定义的 TABLE (success, message)
      const result = data[0]; 

      if (result.success) {
        onVerified();
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError('验证服务异常，请稍后再试');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 flex flex-col items-center gap-6">
      <div className="text-center space-y-2">
        <h2 className="text-[#FFD700] font-serif italic text-xl tracking-[0.2em] drop-shadow-lg">认证专属浪漫</h2>
        <div className="h-[1px] w-12 bg-[#FFD700]/30 mx-auto" />
        <p className="text-white/50 text-[10px] uppercase tracking-widest leading-loose">
          请输入礼赠验证码<br/>开启您的 3D 粒子定制之旅
        </p>
      </div>

      <div className="w-full space-y-4">
        <input 
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-[#FFD700] text-center text-lg tracking-[0.2em] outline-none focus:border-[#FFD700]/40 transition-all placeholder:text-white/10"
        />
        
        {error && <p className="text-red-400/80 text-[10px] text-center italic animate-pulse">{error}</p>}

        <button
          onClick={handleVerify}
          disabled={loading || !code}
          className="w-full py-4 bg-[#FFD700] text-black font-bold text-xs rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-30 disabled:grayscale shadow-[0_0_20px_rgba(255,215,0,0.2)]"
        >
          {loading ? '正在校验流光暗号...' : '立即解锁定制'}
        </button>
      </div>

      <div className="flex flex-col items-center gap-2">
        <a 
          href="你的发卡平台链接" 
          target="_blank" 
          rel="noreferrer"
          className="text-white/30 text-[9px] underline hover:text-[#FFD700] transition-colors tracking-widest"
        >
          未持有礼赠码？点击此处获取
        </a>
      </div>
    </div>
  );
};