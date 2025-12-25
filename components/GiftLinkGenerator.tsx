import React, { useState } from 'react';
import OSS from 'ali-oss';
import { QRCodeSVG } from 'qrcode.react';
import { createClient } from '@supabase/supabase-js';
import imageCompression from 'browser-image-compression';

// --- 初始化 Supabase ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- 错误信息翻译官 ---
const getFriendlyErrorMessage = (error: any): string => {
  const msg = (error.message || error.toString()).toLowerCase();

  // 1. 唯一性冲突 (ID 被占用)
  if (msg.includes('duplicate key') || msg.includes('unique constraint') || msg.includes('id_exists')) {
    return "哎呀，这个专属 ID 已经被别人抢先使用了，换一个更有创意的吧！";
  }

  // 2. 违反字符格式
  if (msg.includes('violates check constraint') || msg.includes('validation_failed')) {
    return "ID 格式不太对哦，只能包含字母、数字、横线(-) 或 下划线(_)";
  }

  // 3. 网络或连接问题
  if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('connection')) {
    return "网络信号去流浪了，请检查网络后重试";
  }

  // 4. 超时
  if (msg.includes('timeout')) {
    return "上传请求超时，可能是图片太大了，请重试";
  }

  // 5. RPC 自定义报错 (假设后端抛出 'Invalid Code')
  if (msg.includes('invalid code') || msg.includes('code_error')) {
    return "流光暗号似乎不正确，请检查是否输入有误";
  }

  // 6. 如果已经是中文 (即前端自己 throw 的 Error)，直接返回
  if (/[\u4e00-\u9fa5]/.test(error.message)) {
    return error.message;
  }

  // 7. 兜底未知错误
  return "生成过程中遇到了一点小插曲，请稍后再试";
};

interface Props {
  onSuccess?: (id: string) => void;
}

export const GiftLinkGenerator: React.FC<Props> = ({ onSuccess }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [giftCode, setGiftCode] = useState('');
  const [customId, setCustomId] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  // --- OSS client 初始化 ---
  const client = new OSS({
    region: import.meta.env.VITE_ALI_REGION || 'oss-cn-beijing',
    accessKeyId: import.meta.env.VITE_ALI_KEY_ID || '',
    accessKeySecret: import.meta.env.VITE_ALI_KEY_SECRET || '',
    bucket: import.meta.env.VITE_ALI_BUCKET || '',
    secure: true,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (e.target.files.length > 15) {
        alert("为了保证体验，最多只能上传 15 张照片哦");
        return;
      }
      setFiles(Array.from(e.target.files));
      setStatus('idle');
      setErrorMessage('');
    }
  };

  const compressImage = async (file: File) => {
    const options = { maxSizeMB: 0.8, maxWidthOrHeight: 1920, useWebWorker: true, fileType: 'image/jpeg' };
    try { return await imageCompression(file, options); } 
    catch (error) { return file; }
  };

  const generateGift = async () => {
    // 1. 基础前端验证
    if (!giftCode.trim()) {
      setErrorMessage("请填写专属流光暗号");
      setStatus('error');
      return;
    }
    const idRegex = /^[a-zA-Z0-9-_]+$/;
    if (!customId || !idRegex.test(customId)) {
      setErrorMessage("ID 只能包含字母、数字、横线(-) 或 下划线(_)");
      setStatus('error');
      return;
    }
    if (files.length === 0) {
      setErrorMessage("请挑选几张珍藏的照片");
      setStatus('error');
      return;
    }

    try {
      // 2.【新增步骤】预校验 ID 是否可用 (为了节省 OSS 流量和用户时间)
      setStatus('checking'); // 新增一个检查状态
      
      // 注意：这里假设你的表名是 'gifts'，请根据实际表名修改
      // 只要查询有没有这个 ID 即可，不需要查其他数据
      const { data: existingData, error: checkError } = await supabase
        .from('gifts') 
        .select('id')
        .eq('custom_id', customId) // 假设数据库字段是 custom_id，如果是 id 请修改
        .maybeSingle();

      if (checkError) throw checkError; // 抛出网络或数据库连接错误

      if (existingData) {
        // 手动抛出一个包含特定关键词的错误，让翻译官处理
        throw new Error('id_exists');
      }

      // 3. ID 可用，开始上传 OSS
      setStatus('uploading');
      setUploadProgress(5);

      const uploadPromises = files.map(async (originalFile, i) => {
        const compressedFile = await compressImage(originalFile);
        const extension = 'jpg';
        const objectName = `gifts/${customId}/${Date.now()}-${i}.${extension}`;
        const result = await client.put(objectName, compressedFile);
        
        setUploadProgress(prev => {
           // 进度条平滑处理，最多走到 80%，剩下 20% 给数据库写入
           return Math.min(prev + (75 / files.length), 80);
        });
        
        let url = result.url;
        if (url.startsWith('http://')) { url = url.replace('http://', 'https://'); }
        return url; 
      });

      const photoUrls = await Promise.all(uploadPromises);

      // 4. 调用 RPC 写入数据库
      const { data, error: rpcError } = await supabase.rpc('create_gift_with_code', {
        input_code: giftCode.trim().toUpperCase(),
        input_custom_id: customId,
        input_photo_urls: photoUrls
      });

      if (rpcError) throw rpcError;

      const result = data; //有些 supabase 版本返回 data 是对象，有些是数组 data[0]，请根据实际情况调整
      // 如果 RPC 返回结构是数组: const result = data[0];
      
      // 兼容性处理：如果 result 是数组取第一个，如果是对象直接用
      const resultObj = Array.isArray(result) ? result[0] : result;

      if (resultObj && !resultObj.success) {
        throw new Error(resultObj.message || "暗号似乎不正确，请检查后重试");
      }

      // 5. 完成
      setUploadProgress(100);
      const link = `${window.location.origin}?id=${customId}`;
      setGeneratedLink(link);
      setStatus('success');
      onSuccess?.(customId);

    } catch (err: any) {
      console.error('Process Error:', err);
      // 调用翻译官
      const friendlyMsg = getFriendlyErrorMessage(err);
      setErrorMessage(friendlyMsg);
      setStatus('error');
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink);
    alert("美好已准备就绪，复制链接发送给 TA 吧"); 
  };

  return (
    <>
      <style>
        {`
          .font-serif-elegant { font-family: "Songti SC", "STSong", "SimSun", "Noto Serif SC", serif; }
          .font-handwriting { font-family: "STKaiti", "KaiTi", "KaiTi_GB2312", "FangSong", "Kaiti SC", cursive; }
          
          @keyframes shine {
            from { transform: translateX(-100%) skewX(-15deg); }
            to { transform: translateX(200%) skewX(-15deg); }
          }
          .animate-shine { animation: shine 3s infinite; }
          
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-4px); }
            75% { transform: translateX(4px); }
          }
          .animate-shake { animation: shake 0.4s ease-in-out; }
          
          .cursor-wait { cursor: wait; }
        `}
      </style>

      <div className="w-full max-w-md mx-auto mt-10 relative z-50 px-2">
        {/* 背景光晕装饰 */}
        <div className="absolute -top-10 -left-10 w-32 h-32 bg-rose-400/20 rounded-full blur-[50px] pointer-events-none"></div>
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-purple-400/20 rounded-full blur-[50px] pointer-events-none"></div>

        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20 shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] relative overflow-hidden transition-all duration-500">
          {/* 顶部装饰线 */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-rose-300/50 to-transparent"></div>

          {status === 'success' ? (
            /* --- 成功状态 --- */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 flex flex-col items-center text-center">
              <div className="mb-6">
                <span className="text-4xl">💌</span>
              </div>
              
              <h3 className="text-rose-100 text-2xl font-serif-elegant font-bold mb-2 tracking-wide">"礼赠已成，静候亲启"</h3>
              <p className="text-rose-200/80 font-handwriting text-xl mb-8 tracking-wider">"一码定格流光，将独家记忆，分享给最爱的TA"</p>

              <div className="p-4 bg-white rounded-xl shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500">
                <div className="relative">
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm z-10">
                            <span className="text-rose-500 text-xs">❤</span>
                        </div>
                    </div>
                    <QRCodeSVG 
                        value={generatedLink} 
                        size={160} 
                        level="H"
                        fgColor="#881337" 
                        bgColor="#ffffff"
                    />
                </div>
              </div>

              <div className="w-full mt-8 space-y-4">
                  <div 
                    onClick={copyToClipboard}
                    className="group bg-rose-500/10 border border-rose-300/20 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:bg-rose-500/20 transition-all active:scale-[0.98]"
                  >
                      <div className="flex-1 text-left overflow-hidden">
                        <p className="text-rose-200/50 text-[10px] uppercase tracking-widest mb-1 font-sans">专属链接</p>
                        <p className="text-rose-100 text-xs truncate font-serif-elegant tracking-wide">{generatedLink}</p>
                      </div>
                      <span className="text-rose-300 group-hover:text-rose-100 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>
                      </span>
                  </div>
              </div>
            </div>
          ) : (
            /* --- 上传表单 --- */
            <div className="space-y-8 px-2">
              <div className="text-center space-y-2">
                  <h3 className="text-white text-2xl font-serif-elegant tracking-widest font-bold">定制圣诞礼赠</h3>
                  <p className="text-rose-200/60 text-lg font-handwriting tracking-wide">Igniting memories within the tree.</p>
              </div>

              {/* 1. 礼品码输入 */}
              <div className="relative group">
                <input 
                  type="text"
                  placeholder=" "
                  value={giftCode}
                  onChange={(e) => setGiftCode(e.target.value)}
                  disabled={status === 'uploading' || status === 'checking'}
                  className="peer w-full bg-transparent border-b border-rose-200/20 text-[#FFD700] px-2 py-3 outline-none focus:border-[#FFD700]/50 transition-all font-serif-elegant placeholder-transparent tracking-[0.2em] disabled:opacity-50"
                />
                <label className="absolute left-2 -top-5 text-[#FFD700]/40 text-xs transition-all peer-placeholder-shown:text-base peer-placeholder-shown:top-2 peer-placeholder-shown:text-rose-200/30 peer-focus:-top-5 peer-focus:text-xs peer-focus:text-[#FFD700]/60 font-handwriting">
                  请输入流光暗号 (礼品兑换码)
                </label>
              </div>

              {/* 2. ID 输入框 */}
              <div className="relative group">
                <input 
                  type="text"
                  placeholder=" "
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value.trim())}
                  disabled={status === 'uploading' || status === 'checking'}
                  className="peer w-full bg-transparent border-b border-rose-200/20 text-rose-50 px-2 py-3 outline-none focus:border-rose-300 transition-all font-serif-elegant placeholder-transparent tracking-wide disabled:opacity-50"
                />
                <label className="absolute left-2 -top-5 text-rose-200/40 text-xs transition-all peer-placeholder-shown:text-base peer-placeholder-shown:top-2 peer-placeholder-shown:text-rose-200/30 peer-focus:-top-5 peer-focus:text-xs peer-focus:text-rose-300 font-handwriting">
                  请输入要定制的id (例如：Xyza)
                </label>
              </div>

              {/* 3. 上传区域 */}
              <div className="group relative">
                <div className={`
                    relative border border-dashed rounded-xl h-36 flex flex-col items-center justify-center transition-all duration-300 overflow-hidden
                    ${files.length > 0 ? 'border-rose-400/50 bg-rose-500/10' : 'border-rose-200/20 hover:border-rose-300/40 hover:bg-white/5'}
                `}>
                    <input 
                        type="file" 
                        multiple 
                        accept="image/*"
                        onChange={handleFileChange}
                        disabled={status === 'uploading' || status === 'checking'}
                        className="absolute inset-0 opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                    />
                    
                    {files.length > 0 ? (
                        <div className="text-center animate-in zoom-in duration-300">
                             <div className="text-2xl mb-1">📸</div>
                             <p className="text-rose-100 font-serif-elegant text-lg">{files.length} 张照片</p>
                             <p className="text-rose-300/50 text-xs mt-1 font-handwriting">已准备好上传</p>
                        </div>
                    ) : (
                        <div className="text-center group-hover:scale-105 transition-transform duration-300">
                            <div className="text-rose-200/40 text-2xl mb-2">✦</div>
                            <p className="text-rose-100/70 text-lg font-handwriting tracking-wider">点击选择照片</p>
                            <p className="text-rose-200/30 text-[10px] mt-1 font-serif-elegant">至多上传15张</p>
                        </div>
                    )}
                </div>
              </div>

              {/* 4. 按钮与进度 */}
              <div className="pt-2">
                {(status === 'uploading' || status === 'checking') && (
                  <div className="w-full h-1 bg-rose-900/30 mb-4 rounded-full overflow-hidden">
                    <div 
                        className={`h-full bg-gradient-to-r from-rose-400 to-purple-400 transition-all duration-500 shadow-[0_0_10px_rgba(251,113,133,0.5)]`} 
                        style={{ width: status === 'checking' ? '5%' : `${uploadProgress}%` }} 
                    />
                  </div>
                )}
                
                <button 
                  onClick={generateGift}
                  disabled={status === 'uploading' || status === 'checking'}
                  className={`
                    w-full py-3.5 rounded-lg text-white font-medium text-sm tracking-[0.2em] transition-all duration-500 font-serif-elegant relative overflow-hidden
                    ${(status === 'uploading' || status === 'checking')
                        ? 'bg-rose-900/20 cursor-wait' 
                        : 'bg-gradient-to-r from-rose-500/80 to-purple-600/80 hover:from-rose-500 hover:to-purple-600 shadow-[0_4px_20px_rgba(225,29,72,0.3)] hover:shadow-[0_6px_25px_rgba(225,29,72,0.4)] hover:-translate-y-0.5'
                    }
                  `}
                >
                  {/* 按钮流光动画 */}
                  {(status !== 'uploading' && status !== 'checking') && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] animate-shine pointer-events-none"></div>}
                  
                  {status === 'checking' ? (
                      <span className="animate-pulse">校验 ID 中...</span>
                  ) : status === 'uploading' ? (
                      <span className="animate-pulse">美好定制中...</span>
                  ) : (
                      '确认生成'
                  )}
                </button>
                
                {status === 'error' && (
                  <p className="mt-4 text-red-300 text-xs text-center font-light animate-shake font-handwriting tracking-wide">
                    {errorMessage}
                  </p>
                )}
              </div>

              {/* 底部获取验证码提示 */}
              <div className="text-center mt-6">
                  <a 
                    href="https://xhslink.com/m/asfnQKWrrc" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-block px-4 py-2 rounded-full border border-[#FFD700] text-[#FFD700] text-xs font-bold tracking-widest hover:bg-[#FFD700] hover:text-black transition-all duration-300 shadow-[0_0_10px_rgba(255,215,0,0.2)] hover:shadow-[0_0_20px_rgba(255,215,0,0.6)]"
                  >
                    没有兑换码？点击获取专属兑换码
                  </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
