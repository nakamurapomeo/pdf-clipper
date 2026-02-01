import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Scissors, Eraser, Plus, Trash2, FileText, Download, Edit3, Save, Eye, ZoomIn, ZoomOut, Sparkles, ExternalLink, Copy, Loader2, Key, ChevronLeft, ChevronRight, RefreshCw, X, Check, Settings, Minus } from 'lucide-react';

// ライブラリの動的ロード用
const useScript = (src) => {
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => setLoaded(true);
        document.body.appendChild(script);
        return () => { document.body.removeChild(script); };
    }, [src]);
    return loaded;
};

const formatDate = (date) => `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
const formatShortDate = (date) => `${date.getMonth() + 1}/${date.getDate()}`;
const formatDateKey = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const copyToClipboardFallback = (text) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    let success = false;
    try { success = document.execCommand("copy"); } catch (err) { console.error(err); }
    document.body.removeChild(textarea);
    return success;
};

const AI_MODELS = [
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', inputCost: 0.1, outputCost: 0.4 },
    { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', inputCost: 0.1, outputCost: 0.4 },
    { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro', inputCost: 1.25, outputCost: 5.0 },
];
const NEWSPAPERS = [
    { key: 'agri', label: '日本農業新聞' },
    { key: 'nikkei', label: '日本経済新聞' },
    { key: 'mj', label: '日経MJ' },
    { key: 'commercial', label: '商業施設新聞' }
];

const PDFClipperApp = () => {
    useScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    useScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js');
    useScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

    const [files, setFiles] = useState([]);
    const [selectedFileIndex, setSelectedFileIndex] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [mode, setMode] = useState('view');
    const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
    const [masks, setMasks] = useState([]);
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [clips, setClips] = useState([]);
    const [fileDate, setFileDate] = useState(new Date());
    const [fileNamePrefix, setFileNamePrefix] = useState('【共有事項】');
    const [matrixCounts, setMatrixCounts] = useState({});
    const [previewUrl, setPreviewUrl] = useState(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [openRouterApiKey, setOpenRouterApiKey] = useState('');
    const [selectedModel, setSelectedModel] = useState(AI_MODELS[0].id);
    const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
    const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
    const [interactionState, setInteractionState] = useState({ type: 'none', target: null, index: null });
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });

    const canvasRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        const storedKey = localStorage.getItem('openRouterApiKey');
        if (storedKey) setOpenRouterApiKey(storedKey);
    }, []);

    const handleFileUpload = async (uploadedFiles) => {
        if (!window.pdfjsLib) return;
        const newFiles = [];
        for (const file of Array.from(uploadedFiles)) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise;
            newFiles.push({ name: file.name, data: arrayBuffer, pdf, pageCount: pdf.numPages });
        }
        setFiles(prev => [...prev, ...newFiles]);
        if (selectedFileIndex === null && newFiles.length > 0) setSelectedFileIndex(files.length);
    };

    const renderPage = useCallback(async () => {
        if (selectedFileIndex === null || !files[selectedFileIndex] || !canvasRef.current) return;
        const page = await files[selectedFileIndex].pdf.getPage(currentPage);
        const containerW = containerRef.current?.clientWidth || 800;
        const containerH = containerRef.current?.clientHeight || 600;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = Math.min(containerW / unscaled.width, containerH / unscaled.height) * 0.95 * zoomLevel;
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }, [selectedFileIndex, files, currentPage, rotation, zoomLevel]);

    useEffect(() => { renderPage(); }, [renderPage]);

    const getMousePos = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    };

    const handleMouseDown = (e) => {
        if (mode === 'view') return;
        const pos = getMousePos(e);
        setStartPos(pos);
        if (mode === 'mask') {
            const newMask = { x: pos.x, y: pos.y, w: 0, h: 0 };
            setMasks([...masks, newMask]);
            setInteractionState({ type: 'create', target: 'mask', index: masks.length });
        } else {
            setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
            setInteractionState({ type: 'create', target: 'crop' });
        }
    };

    const handleMouseMove = (e) => {
        if (interactionState.type === 'none') return;
        const pos = getMousePos(e);
        const rect = { x: Math.min(startPos.x, pos.x), y: Math.min(startPos.y, pos.y), w: Math.abs(pos.x - startPos.x), h: Math.abs(pos.y - startPos.y) };
        if (interactionState.target === 'mask') {
            const newMasks = [...masks];
            newMasks[interactionState.index] = rect;
            setMasks(newMasks);
        } else {
            setCropRect(rect);
        }
    };

    const handleMouseUp = () => setInteractionState({ type: 'none', target: null, index: null });

    const saveClip = async () => {
        if (selectedFileIndex === null || cropRect.w === 0) return;
        const canvas = canvasRef.current;
        const offscreen = document.createElement('canvas');
        const ctx = offscreen.getContext('2d');
        const x = cropRect.x * canvas.width, y = cropRect.y * canvas.height, w = cropRect.w * canvas.width, h = cropRect.h * canvas.height;
        offscreen.width = w; offscreen.height = h;
        ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        const dataUrl = offscreen.toDataURL('image/jpeg');
        const newClip = { id: Date.now(), dataUrl, title: '', scalePercent: 100, aspectRatio: w / h };
        setClips([...clips, newClip]);
        setCropRect({ x: 0, y: 0, w: 0, h: 0 });
        setMode('view');
    };

    const analyzeTitleWithAI = async (id) => {
        const clip = clips.find(c => c.id === id);
        if (!clip || !openRouterApiKey) {
            if (!openRouterApiKey) alert("設定からOpenRouter APIキーを入力してください。");
            return;
        }
        setClips(prev => prev.map(c => c.id === id ? { ...c, isAnalyzing: true } : c));
        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openRouterApiKey}` },
                body: JSON.stringify({
                    model: selectedModel,
                    messages: [{
                        role: 'user', content: [
                            { type: 'text', text: "この新聞記事の見出し（タイトル）のみを正確に抽出して返してください。説明は不要です。" },
                            { type: 'image_url', image_url: { url: clip.dataUrl } }
                        ]
                    }]
                })
            });
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content?.trim() || "抽出失敗";
            setClips(prev => prev.map(c => c.id === id ? { ...c, title: text, isAnalyzing: false } : c));
        } catch (e) {
            alert(`AI解析エラー: ${e.message}`);
            setClips(prev => prev.map(c => c.id === id ? { ...c, isAnalyzing: false, title: "エラー" } : c));
        }
    };

    const analyzeAllTitles = async () => { if (confirm("全件解析を開始しますか？")) for (const c of clips) await analyzeTitleWithAI(c.id); };

    const updateMatrixCount = (date, key, delta) => {
        const dKey = formatDateKey(date);
        setMatrixCounts(prev => {
            const current = prev[dKey] || { agri: 0, nikkei: 0, mj: 0, commercial: 0 };
            return { ...prev, [dKey]: { ...current, [key]: Math.max(0, (current[key] || 0) + delta) } };
        });
    };

    const createPdfBlob = async (targetClips = clips) => {
        if (!window.PDFLib || targetClips.length === 0) return null;
        const doc = await window.PDFLib.PDFDocument.create();
        for (const clip of targetClips) {
            const img = await doc.embedJpg(clip.dataUrl);
            const page = doc.addPage([595.28, 841.89]);
            const margin = 20;
            const availW = 595.28 - margin * 2, availH = 841.89 - margin * 2;
            const scale = Math.min(availW / img.width, availH / img.height) * (clip.scalePercent / 100);
            page.drawImage(img, { x: (595.28 - img.width * scale) / 2, y: (841.89 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
        }
        return new Blob([await doc.save()], { type: 'application/pdf' });
    };

    const downloadPDF = async () => {
        const blob = await createPdfBlob();
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Clipped_${formatDate(new Date())}.pdf`;
        link.click();
    };

    const copyAndOpenCybozu = () => {
        const text = clips.map(c => `・${c.title}`).join('\n');
        copyToClipboardFallback(text);
        alert("タイトルをコピーしました。Cybozuを開きます。");
        window.open('https://op7oo.cybozu.com/o/ag.cgi?page=MyFolderMessageView&mid=455345&mdbid=10', '_blank');
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans">
            <header className="h-14 bg-white border-b shadow-sm flex items-center justify-between px-4 z-10">
                <div className="flex items-center gap-2 text-blue-600"><Scissors size={24} /> <h1 className="font-extrabold text-xl tracking-tight">PDF Clipper</h1></div>
                <div className="flex gap-2">
                    <button onClick={() => setSettingsOpen(true)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-all"><Settings size={20} /></button>
                    <label className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold cursor-pointer hover:bg-blue-700 shadow-md transition-all active:scale-95">
                        <Upload size={16} /><span>PDF追加</span>
                        <input type="file" multiple accept="application/pdf" className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                    </label>
                </div>
            </header>
            <div className="flex flex-1 overflow-hidden">
                <div className={`${leftSidebarOpen ? 'w-64 border-r' : 'w-0'} bg-white transition-all overflow-y-auto overflow-x-hidden flex flex-col`}>
                    <div className="p-3 bg-gray-50 border-b">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">記事数カウンター</div>
                        <table className="w-full text-[10px] border-separate border-spacing-px">
                            <thead><tr><th></th>{[0, 1, 2, 3, 4].map(i => <th key={i} className="pb-1">{formatShortDate(new Date(Date.now() - i * 86400000))}</th>)}</tr></thead>
                            <tbody>{NEWSPAPERS.map(np => (
                                <tr key={np.key}>
                                    <td className="font-bold py-1">{np.label.substring(0, 2)}</td>
                                    {[0, 1, 2, 3, 4].map(i => {
                                        const d = new Date(Date.now() - i * 86400000);
                                        const count = matrixCounts[formatDateKey(d)]?.[np.key] || 0;
                                        return <td key={i} className={`text-center py-1 cursor-pointer transition-colors rounded ${count > 0 ? 'bg-blue-100 text-blue-700 font-bold' : 'hover:bg-gray-100 text-gray-300'}`} onClick={() => updateMatrixCount(d, np.key, 1)} onContextMenu={(e) => { e.preventDefault(); updateMatrixCount(d, np.key, -1) }}>{count || '-'}</td>
                                    })}
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                    <div className="flex-1 p-2 space-y-1">
                        <div className="text-[10px] font-bold text-gray-400 px-1 mb-2">アップロード済み</div>
                        {files.map((f, i) => (
                            <div key={i} onClick={() => setSelectedFileIndex(i)} className={`p-2 rounded-md text-sm cursor-pointer truncate transition-all ${selectedFileIndex === i ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-gray-50'}`}>{f.name}</div>
                        ))}
                    </div>
                </div>
                <div className="flex-1 flex flex-col bg-gray-200 relative min-w-0">
                    <div className="h-12 bg-white border-b flex items-center justify-between px-4">
                        <div className="flex gap-1">
                            <button onClick={() => setMode('crop')} className={`p-2 rounded-lg transition-all ${mode === 'crop' ? 'bg-green-100 text-green-600 shadow-inner' : 'hover:bg-gray-100'}`}><Scissors size={18} /></button>
                            <button onClick={() => setMode('mask')} className={`p-2 rounded-lg transition-all ${mode === 'mask' ? 'bg-red-100 text-red-600 shadow-inner' : 'hover:bg-gray-100'}`}><Eraser size={18} /></button>
                            <div className="w-px h-6 bg-gray-200 mx-2"></div>
                            <div className="flex items-center gap-1 bg-gray-50 px-2 rounded-lg">
                                <button onClick={() => setRotation(r => r - 0.1)} className="p-1 hover:bg-gray-200 rounded text-[10px] font-bold">-0.1</button>
                                <span className="text-[10px] w-10 text-center font-mono">{rotation.toFixed(1)}°</span>
                                <button onClick={() => setRotation(r => r + 0.1)} className="p-1 hover:bg-gray-200 rounded text-[10px] font-bold">+0.1</button>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 bg-gray-50 px-4 py-1.5 rounded-full">
                            <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="hover:text-blue-600 transition-colors"><Minus size={16} /></button>
                            <span className="text-xs font-bold w-12 text-center">{Math.round(zoomLevel * 100)}%</span>
                            <button onClick={() => setZoomLevel(z => Math.min(3, z + 0.1))} className="hover:text-blue-600 transition-colors"><Plus size={16} /></button>
                        </div>
                    </div>
                    <div ref={containerRef} className="flex-1 overflow-auto p-8 flex justify-center no-scrollbar">
                        {selectedFileIndex !== null && (
                            <div className="relative bg-white shadow-2xl mx-auto self-start ring-1 ring-black/5">
                                <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} className={mode !== 'view' ? 'cursor-crosshair' : 'cursor-default'} />
                                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                    {cropRect.w > 0 && <rect x={`${cropRect.x * 100}%`} y={`${cropRect.y * 100}%`} width={`${cropRect.w * 100}%`} height={`${cropRect.h * 100}%`} fill="rgba(34,197,94,0.1)" stroke="#22c55e" strokeWidth="2" strokeDasharray="4" />}
                                    {masks.map((m, i) => <rect key={i} x={`${m.x * 100}%`} y={`${m.y * 100}%`} width={`${m.w * 100}%`} height={`${m.h * 100}%`} fill="white" stroke="#eee" />)}
                                </svg>
                            </div>
                        )}
                    </div>
                    <div className="h-14 bg-white border-t flex items-center justify-between px-6">
                        <div className="text-xs font-medium text-gray-400">P.{currentPage} / {files[selectedFileIndex]?.pageCount || 1}</div>
                        <div className="flex gap-2">
                            <button onClick={() => { setCropRect({ x: 0, y: 0, w: 0, h: 0 }); setMasks([]); setMode('view'); }} className="px-4 py-1.5 text-sm hover:underline text-gray-400">クリア</button>
                            <button onClick={saveClip} className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full text-sm font-bold shadow-lg hover:shadow-indigo-200 transition-all active:scale-95">クリップリストに追加</button>
                        </div>
                    </div>
                </div>
                <div className={`${rightSidebarOpen ? 'w-72 border-l' : 'w-0'} bg-white transition-all overflow-y-auto flex flex-col`}>
                    <div className="p-4 bg-gray-50 border-b font-extrabold text-sm flex justify-between">結合リスト <span className="text-blue-600">{clips.length}</span></div>
                    <div className="flex-1 p-3 space-y-4">
                        {clips.map(c => (
                            <div key={c.id} className="p-3 border rounded-xl bg-white shadow-sm space-y-3 hover:shadow-md transition-shadow ring-1 ring-black/5">
                                <div className="relative aspect-video bg-gray-50 rounded-lg overflow-hidden flex items-center justify-center">
                                    <img src={c.dataUrl} className="max-w-full max-h-full object-contain" alt="clip" />
                                    <button onClick={() => setClips(clips.filter(x => x.id !== c.id))} className="absolute top-1 right-1 p-1 bg-white/80 rounded-full text-red-500 hover:bg-red-50 shadow-sm"><X size={14} /></button>
                                </div>
                                <div className="flex gap-2">
                                    <input value={c.title} onChange={(e) => setClips(clips.map(x => x.id === c.id ? { ...x, title: e.target.value } : x))} className="flex-1 text-xs border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-100 outline-none" placeholder="記事タイトル..." />
                                    <button onClick={() => analyzeTitleWithAI(c.id)} className="p-2 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors shadow-sm">{c.isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}</button>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                    <span>サイズ: {c.scalePercent}%</span>
                                    <input type="range" min="10" max="100" value={c.scalePercent} onChange={(e) => setClips(clips.map(x => x.id === c.id ? { ...x, scalePercent: parseInt(e.target.value) } : x))} className="flex-1 h-1 bg-gray-100 appearance-none rounded-full cursor-pointer accent-blue-500" />
                                </div>
                            </div>
                        ))}
                        {clips.length === 0 && <div className="text-center py-20 text-gray-300 text-xs italic">クリップを追加してください</div>}
                    </div>
                    <div className="p-4 bg-gray-50 border-t space-y-3">
                        <button onClick={analyzeAllTitles} disabled={clips.length === 0} className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl text-xs font-bold shadow-lg hover:opacity-90 disabled:opacity-30 transition-all active:scale-95">すべてAI解析</button>
                        <button onClick={copyAndOpenCybozu} className="w-full py-2.5 bg-white border border-blue-600 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-50 transition-all active:scale-95">Cybozuへ投稿</button>
                        <button onClick={downloadPDF} className="w-full py-2.5 bg-gray-800 text-white rounded-xl text-xs font-bold shadow-lg hover:bg-black transition-all active:scale-95">PDFをダウンロード</button>
                    </div>
                </div>
            </div>
            {settingsOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl p-8 w-full max-w-sm space-y-6 shadow-2xl relative">
                        <button onClick={() => setSettingsOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={24} /></button>
                        <h3 className="text-xl font-extrabold text-gray-800 flex items-center gap-2"><Key className="text-blue-500" /> 設定</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-gray-400 mb-2 block uppercase tracking-wider">OpenRouter APIキー</label>
                                <input type="password" value={openRouterApiKey} onChange={(e) => setOpenRouterApiKey(e.target.value)} className="w-full p-3 bg-gray-50 border rounded-xl text-sm focus:ring-4 focus:ring-blue-50 outline-none transition-all" placeholder="sk-or-..." />
                                <p className="text-[10px] text-gray-400 mt-2">※ブラウザのlocalStorageに保存されます。</p>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-400 mb-2 block uppercase tracking-wider">AIモデル</label>
                                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="w-full p-3 bg-gray-50 border rounded-xl text-sm outline-none">
                                    {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <button onClick={() => { localStorage.setItem('openRouterApiKey', openRouterApiKey); localStorage.setItem('selectedModel', selectedModel); setSettingsOpen(false) }} className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95">保存して閉じる</button>
                    </div>
                </div>
            )}
        </div>
    );
};
export default PDFClipperApp;
