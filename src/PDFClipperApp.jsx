import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Scissors, Eraser, Plus, Trash2, FileText, Download, Edit3, Save, Eye, ZoomIn, ZoomOut, Sparkles, ExternalLink, Copy, Loader2, Key, ChevronLeft, ChevronRight, RefreshCw, X, Check, Settings } from 'lucide-react';

// 繝ｩ繧､繝悶Λ繝ｪ縺ｮ蜍慕噪繝ｭ繝ｼ繝臥畑繝輔ャ繧ｯ
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

const HANDLE_SIZE_PX = 10;
const MIN_RECT_SIZE = 0.01;

// OpenRouter 繝｢繝・Ν螳夂ｾｩ (繧ｳ繧ｹ繝・ 讎らｮ・$/1M output)
const AI_MODELS = [
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', inputCost: 0.1, outputCost: 0.4 },
    { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', inputCost: 0.1, outputCost: 0.4 },
    { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro', inputCost: 1.25, outputCost: 5.0 },
];
// 新聞定義（順序変更: 農業 -> 日経 -> MJ -> 商業）
const NEWSPAPERS = [
    { key: 'agri', label: '日本農業新聞' },
    { key: 'nikkei', label: '日本経済新聞' },
    { key: 'mj', label: '日経MJ' },
    { key: 'commercial', label: '商業施設新聞' }
];

const PDFClipperApp = () => {
    const pdfJsLoaded = useScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdfLibLoaded = useScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js');
    const jszipLoaded = useScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

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
    const [outputFileName, setOutputFileName] = useState(`【共有事項】${formatDate(new Date())}`);
    // 新聞記事カウンター (Matrix: YYYY-MM-DD -> { key: count })
    const [matrixCounts, setMatrixCounts] = useState({});
    const [previewUrl, setPreviewUrl] = useState(null);
    const [copied, setCopied] = useState(false);
    const [aiModalOpen, setAiModalOpen] = useState(false);
    const [aiResult, setAiResult] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [editingClipId, setEditingClipId] = useState(null);
    const [totalCost, setTotalCost] = useState(0);
    const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
    const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

    // 險ｭ螳夐未騾｣State
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [openRouterApiKey, setOpenRouterApiKey] = useState('');
    const [selectedModel, setSelectedModel] = useState(AI_MODELS[0].id);

    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    // 繧ｳ繝ｳ繝・リ繧ｵ繧､繧ｺ逶｣隕也畑
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(() => renderPage());
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [containerRef.current]);

    const [interactionState, setInteractionState] = useState({ type: 'none', target: null, index: null, handle: null });
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [initialRect, setInitialRect] = useState(null);

    // localStorage 縺九ｉ險ｭ螳壹ｒ隱ｭ縺ｿ霎ｼ縺ｿ
    useEffect(() => {
        const savedApiKey = localStorage.getItem('openRouterApiKey');
        const savedModel = localStorage.getItem('selectedModel');
        if (savedApiKey) setOpenRouterApiKey(savedApiKey);
        if (savedModel) setSelectedModel(savedModel);
    }, []);

    // 險ｭ螳壹ｒlocalStorage縺ｫ菫晏ｭ・
    const saveSettings = () => {
        localStorage.setItem('openRouterApiKey', openRouterApiKey);
        localStorage.setItem('selectedModel', selectedModel);
        setSettingsOpen(false);
    };

    useEffect(() => {
        setOutputFileName(`${fileNamePrefix}${formatDate(fileDate)}`);
    }, [fileDate, fileNamePrefix]);

    useEffect(() => {
        if (pdfJsLoaded && window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    }, [pdfJsLoaded]);

    const handleFileUpload = async (uploadedFiles) => {
        if (!uploadedFiles || uploadedFiles.length === 0 || !window.pdfjsLib) return;
        const newFiles = [];
        for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            if (file.type === 'application/pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                newFiles.push({ name: file.name, pdf, pageCount: pdf.numPages });
            }
        }
        setFiles(prev => [...prev, ...newFiles]);
        if (selectedFileIndex === null && newFiles.length > 0) {
            setSelectedFileIndex(files.length);
            setCurrentPage(1);
            setRotation(0);
            setCropRect({ x: 0, y: 0, w: 0, h: 0 });
            setMasks([]);
            setEditingClipId(null);
            setZoomLevel(1.0);
            setMode('view');
        }
    };

    const onDrop = (e) => { e.preventDefault(); handleFileUpload(e.dataTransfer.files); };
    const onPaste = (e) => { if (e.clipboardData.files.length > 0) { e.preventDefault(); handleFileUpload(e.clipboardData.files); } };

    const renderPage = useCallback(async () => {
        if (selectedFileIndex === null || !files[selectedFileIndex] || !canvasRef.current) return;
        const file = files[selectedFileIndex];
        const page = await file.pdf.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.0, rotation: 0 });
        const containerWidth = containerRef.current ? containerRef.current.clientWidth - 40 : 800;
        const containerHeight = containerRef.current ? containerRef.current.clientHeight - 40 : 600;

        // Fit Page Logic (蛻晄悄陦ｨ遉ｺ繧Хiew繝｢繝ｼ繝画凾)
        let finalScale = 1.0;
        if (zoomLevel === 1.0) {
            const scaleW = containerWidth / viewport.width;
            const scaleH = containerHeight / viewport.height;
            finalScale = Math.min(scaleW, scaleH);
            // 縺ゅ∪繧翫↓蟆上＆縺上↑繧翫☆縺弱↑縺・ｈ縺・↓蛻ｶ髯・
            if (finalScale < 0.1) finalScale = 0.1;
        } else {
            const baseScale = containerWidth / viewport.width;
            finalScale = baseScale * zoomLevel;
        }

        const scaledViewport = page.getViewport({ scale: finalScale, rotation: 0 });
        const rad = (rotation * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));
        const canvasWidth = Math.floor(scaledViewport.width * cos + scaledViewport.height * sin);
        const canvasHeight = Math.floor(scaledViewport.width * sin + scaledViewport.height * cos);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
        }
        context.save();
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.translate(canvasWidth / 2, canvasHeight / 2);
        context.rotate(rad);
        context.translate(-scaledViewport.width / 2, -scaledViewport.height / 2);
        await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
        context.restore();
    }, [selectedFileIndex, files, currentPage, rotation, zoomLevel]);

    useEffect(() => { renderPage(); }, [renderPage]);

    useEffect(() => {
        if (editingClipId && cropRect.w > 0 && cropRect.h > 0 && containerRef.current) {
            const newZoom = Math.min(3.0, Math.max(0.5, (1 / cropRect.w) * 0.9));
            setZoomLevel(newZoom);
            setTimeout(() => {
                if (containerRef.current) {
                    const container = containerRef.current;
                    const scrollX = (cropRect.x * container.scrollWidth) - (container.clientWidth / 2) + (cropRect.w * container.scrollWidth / 2);
                    const scrollY = (cropRect.y * container.scrollHeight) - (container.clientHeight / 2) + (cropRect.h * container.scrollHeight / 2);
                    container.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });
                }
            }, 100);
        }
    }, [editingClipId]);

    const getNormPos = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    };

    const getPixelPos = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width, height: rect.height };
    };

    const hitTest = (e) => {
        if (mode === 'view') return { type: 'none' };
        const { x: px, y: py, width: cw, height: ch } = getPixelPos(e);
        const handleRadius = HANDLE_SIZE_PX / 2 + 5;
        if (mode === 'mask') {
            for (let i = masks.length - 1; i >= 0; i--) {
                const m = masks[i];
                const mx = m.x * cw, my = m.y * ch, mw = m.w * cw, mh = m.h * ch;
                if (Math.abs(px - mx) < handleRadius && Math.abs(py - my) < handleRadius) return { type: 'resize', target: 'mask', index: i, handle: 'tl' };
                if (Math.abs(px - (mx + mw)) < handleRadius && Math.abs(py - my) < handleRadius) return { type: 'resize', target: 'mask', index: i, handle: 'tr' };
                if (Math.abs(px - mx) < handleRadius && Math.abs(py - (my + mh)) < handleRadius) return { type: 'resize', target: 'mask', index: i, handle: 'bl' };
                if (Math.abs(px - (mx + mw)) < handleRadius && Math.abs(py - (my + mh)) < handleRadius) return { type: 'resize', target: 'mask', index: i, handle: 'br' };
                if (px >= mx && px <= mx + mw && py >= my && py <= my + mh) return { type: 'move', target: 'mask', index: i, handle: null };
            }
            return { type: 'create', target: 'mask', index: null, handle: null };
        }
        if (mode === 'crop') {
            const c = cropRect;
            const cx = c.x * cw, cy = c.y * ch, cw_px = c.w * cw, ch_px = c.h * ch;
            if (c.w > 0 && c.h > 0) {
                if (Math.abs(px - cx) < handleRadius && Math.abs(py - cy) < handleRadius) return { type: 'resize', target: 'crop', index: null, handle: 'tl' };
                if (Math.abs(px - (cx + cw_px)) < handleRadius && Math.abs(py - cy) < handleRadius) return { type: 'resize', target: 'crop', index: null, handle: 'tr' };
                if (Math.abs(px - cx) < handleRadius && Math.abs(py - (cy + ch_px)) < handleRadius) return { type: 'resize', target: 'crop', index: null, handle: 'bl' };
                if (Math.abs(px - (cx + cw_px)) < handleRadius && Math.abs(py - (cy + ch_px)) < handleRadius) return { type: 'resize', target: 'crop', index: null, handle: 'br' };
                if (px >= cx && px <= cx + cw_px && py >= cy && py <= cy + ch_px) return { type: 'move', target: 'crop', index: null, handle: null };
            }
            return { type: 'create', target: 'crop', index: null, handle: null };
        }
        return { type: 'none' };
    };

    const handleMouseDown = (e) => {
        if (mode === 'view') return;
        const hit = hitTest(e);
        if (hit.type === 'none') return;
        const pos = getNormPos(e);
        setStartPos(pos);
        setInteractionState(hit);
        if (hit.type === 'move' || hit.type === 'resize') {
            if (hit.target === 'crop') setInitialRect({ ...cropRect });
            if (hit.target === 'mask') setInitialRect({ ...masks[hit.index] });
        } else if (hit.type === 'create') {
            if (mode === 'crop') {
                setInitialRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
                setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
            } else if (mode === 'mask') {
                const newMask = { x: pos.x, y: pos.y, w: 0, h: 0 };
                setMasks([...masks, newMask]);
                setInitialRect(newMask);
                setInteractionState({ type: 'create', target: 'mask', index: masks.length, handle: null });
            }
        }
    };

    const handleMouseMove = (e) => {
        if (interactionState.type === 'none') return;
        const rect = canvasRef.current.getBoundingClientRect();
        const currentX = (e.clientX - rect.left) / rect.width;
        const currentY = (e.clientY - rect.top) / rect.height;
        const dx = currentX - startPos.x;
        const dy = currentY - startPos.y;
        let newRect = { ...initialRect };
        if (interactionState.type === 'move') {
            newRect.x = initialRect.x + dx;
            newRect.y = initialRect.y + dy;
        } else if (interactionState.type === 'resize') {
            const h = interactionState.handle;
            if (h.includes('l')) { newRect.x += dx; newRect.w -= dx; }
            if (h.includes('t')) { newRect.y += dy; newRect.h -= dy; }
            if (h.includes('r')) { newRect.w += dx; }
            if (h.includes('b')) { newRect.h += dy; }
        } else if (interactionState.type === 'create') {
            newRect = { x: dx > 0 ? startPos.x : currentX, y: dy > 0 ? startPos.y : currentY, w: Math.abs(dx), h: Math.abs(dy) };
        }
        if (newRect.w < 0) { newRect.x += newRect.w; newRect.w = Math.abs(newRect.w); }
        if (newRect.h < 0) { newRect.y += newRect.h; newRect.h = Math.abs(newRect.h); }
        if (interactionState.target === 'crop') setCropRect(newRect);
        else if (interactionState.target === 'mask') {
            const updatedMasks = [...masks];
            const idx = interactionState.type === 'create' ? (interactionState.index >= masks.length ? masks.length - 1 : interactionState.index) : interactionState.index;
            updatedMasks[idx] = newRect;
            setMasks(updatedMasks);
        }
    };

    const handleMouseUp = () => {
        if (interactionState.target === 'mask' && interactionState.type === 'create') {
            const index = interactionState.index;
            if (index < masks.length) {
                const mask = masks[index];
                if (mask && (mask.w < MIN_RECT_SIZE || mask.h < MIN_RECT_SIZE)) setMasks(masks.filter((_, i) => i !== index));
            }
        }
        if (interactionState.target === 'crop' && interactionState.type === 'create') {
            if (cropRect.w < MIN_RECT_SIZE || cropRect.h < MIN_RECT_SIZE) setCropRect({ x: 0, y: 0, w: 0, h: 0 });
        }
        setInteractionState({ type: 'none', target: null, index: null, handle: null });
        setInitialRect(null);
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const handleWheelActive = (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                if (e.deltaY < 0) setZoomLevel(prev => Math.min(prev + 0.05, 3.0));
                else setZoomLevel(prev => Math.max(prev - 0.05, 0.5));
            }
        };
        container.addEventListener('wheel', handleWheelActive, { passive: false });
        return () => { container.removeEventListener('wheel', handleWheelActive); };
    }, []);

    const generateClipImage = async (fileIdx, pageNum, rot, cRect, maskList) => {
        const file = files[fileIdx];
        const page = await file.pdf.getPage(pageNum);
        const highResScale = 3.0;
        const viewport = page.getViewport({ scale: highResScale, rotation: 0 });
        const rad = (rot * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));
        const canvasWidth = Math.floor(viewport.width * cos + viewport.height * sin);
        const canvasHeight = Math.floor(viewport.width * sin + viewport.height * cos);
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = canvasWidth;
        offscreenCanvas.height = canvasHeight;
        const ctx = offscreenCanvas.getContext('2d');
        ctx.save();
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.rotate(rad);
        ctx.translate(-viewport.width / 2, -viewport.height / 2);
        await page.render({ canvasContext: ctx, viewport }).promise;
        ctx.restore();
        ctx.fillStyle = '#FFFFFF';
        maskList.forEach(mask => { ctx.fillRect(mask.x * canvasWidth, mask.y * canvasHeight, mask.w * canvasWidth, mask.h * canvasHeight); });
        let cx = cRect.x, cy = cRect.y, cw = cRect.w, ch = cRect.h;
        if (cw === 0 || ch === 0) { cx = 0; cy = 0; cw = 1; ch = 1; }
        const cropX = cx * canvasWidth, cropY = cy * canvasHeight, cropW = cw * canvasWidth, cropH = ch * canvasHeight;
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = cropW;
        finalCanvas.height = cropH;
        finalCanvas.getContext('2d').drawImage(offscreenCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        return finalCanvas.toDataURL('image/jpeg', 0.95);
    };

    const saveClip = async () => {
        if (selectedFileIndex === null) return;
        if (cropRect.w === 0 || cropRect.h === 0) {
            alert("切り抜き枠（緑の枠）を作成してください。"); return;
        }
        const dataUrl = await generateClipImage(selectedFileIndex, currentPage, rotation, cropRect, masks);
        let currentClipData = { title: '', scalePercent: 100 };
        if (editingClipId) {
            const existingClip = clips.find(c => c.id === editingClipId);
            if (existingClip) { currentClipData.title = existingClip.title; currentClipData.scalePercent = existingClip.scalePercent; }
        }
        const w = cropRect.w || 1, h = cropRect.h || 1;
        const clipData = {
            id: editingClipId || Date.now(), dataUrl, width: w, height: h, aspectRatio: w / h,
            scalePercent: currentClipData.scalePercent, title: currentClipData.title, isAnalyzing: false,
            source: { fileIndex: selectedFileIndex, pageNumber: currentPage, cropRect: { ...cropRect }, masks: [...masks], rotation }
        };
        if (editingClipId) { setClips(prev => prev.map(c => c.id === editingClipId ? clipData : c)); setEditingClipId(null); }
        else { setClips(prev => [...prev, clipData]); }
        setCropRect({ x: 0, y: 0, w: 0, h: 0 });
        setMasks([]);
        setMode('view');
        setZoomLevel(1.0);
    };

    const updateClipScale = (id, newScale) => { setClips(prev => prev.map(c => c.id === id ? { ...c, scalePercent: parseInt(newScale) } : c)); };
    const updateClipTitle = (id, newTitle) => { setClips(prev => prev.map(c => c.id === id ? { ...c, title: newTitle } : c)); };
    const editClip = (clip) => {
        setSelectedFileIndex(clip.source.fileIndex);
        setCurrentPage(clip.source.pageNumber);
        setRotation(clip.source.rotation);
        setCropRect(clip.source.cropRect);
        setMasks(clip.source.masks);
        setEditingClipId(clip.id);
        setMode('view');
    };

    // OpenRouter APIでタイトル抽出・フォールバック処理
    const analyzeTitleWithAI = async (clipId) => {
        const clip = clips.find(c => c.id === clipId);
        if (!clip || !openRouterApiKey) {
            if (!openRouterApiKey) alert("設定からOpenRouter APIキーを入力してください。");
            return;
        }
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, isAnalyzing: true } : c));
        try {
            const base64Data = clip.dataUrl.split(',')[1];
            // まず文字認識でタイトルを抽出
            const textPrompt = "この新聞記事の切り抜き画像から、メインの「見出し（タイトル）」だけを抜き出して文字にしてください。前置きや説明は不要です。タイトル文字列のみを返してください。文字が読み取れない場合は「NO_TEXT」とだけ返してください。";
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openRouterApiKey}` },
                body: JSON.stringify({
                    model: selectedModel,
                    messages: [{
                        role: 'user', content: [
                            { type: 'text', text: textPrompt },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
                        ]
                    }]
                })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error("OpenRouter API Error:", errData);
                throw new Error(errData.error?.message || `API Error: ${response.status}`);
            }
            const data = await response.json();

            // コスト計算
            if (data.usage) {
                const modelInfo = AI_MODELS.find(m => m.id === selectedModel);
                if (modelInfo) {
                    const inputTokens = data.usage.prompt_tokens || 0;
                    const outputTokens = data.usage.completion_tokens || 0;
                    const cost = (inputTokens * modelInfo.inputCost + outputTokens * modelInfo.outputCost) / 1000000;
                    setTotalCost(prev => prev + cost);
                }
            }

            let extractedText = data.choices?.[0]?.message?.content?.trim() || "";

            // フォールバック: 文字が読み取れなかった場合の記事タイトル生成
            if (!extractedText || extractedText === "NO_TEXT" || extractedText.length < 2) {
                const imagePrompt = "この新聞記事の画像を見て、内容を推測し、適切な記事タイトルを1行で生成してください。タイトルのみを返してください。";
                const fallbackResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openRouterApiKey}` },
                    body: JSON.stringify({
                        model: selectedModel,
                        messages: [{
                            role: 'user', content: [
                                { type: 'text', text: imagePrompt },
                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
                            ]
                if(fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    // OpenRouter APIでタイトル抽出（フォールバック付き）
                    if(fallbackData.usage) {
                        const modelInfo = AI_MODELS.find(m => m.id === selectedModel);
                if (modelInfo) {
                    const inputTokens = fallbackData.usage.prompt_tokens || 0;
                    const outputTokens = fallbackData.usage.completion_tokens || 0;
                    const cost = (inputTokens * modelInfo.inputCost + outputTokens * modelInfo.outputCost) / 1000000;
                    setTotalCost(prev => prev + cost);
                }
            }
            extractedText = fallbackData.choices?.[0]?.message?.content?.trim() || "タイトル取得失敗";
        }
            }
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, title: extractedText, isAnalyzing: false } : c));
} catch (e) {
    console.error(e);
    const errorMessage = e.message || "抽出失敗";
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, isAnalyzing: false, title: `エラー: ${errorMessage.substring(0, 20)}...` } : c));
    alert(`AI解析エラー: ${e.message}`);
}
    };

const analyzeAllTitles = async () => {
    if (!openRouterApiKey) {
        alert("設定からOpenRouter APIキーを入力してください。"); return;
    }
    if (!confirm("リスト内のすべてのクリップに対してAI解析を実行しますか？")) return;
    for (const clip of clips) { await analyzeTitleWithAI(clip.id); await new Promise(r => setTimeout(r, 500)); }
};

const copyToClipboard = () => {
    const success = copyToClipboardFallback(aiResult);
    if (success) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
};

const formatDateKey = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const updateMatrixCount = (date, key, delta) => {
    const dKey = formatDateKey(date);
    setMatrixCounts(prev => {
        const currentCounts = prev[dKey] || { nikkei: 0, agri: 0, mj: 0, commercial: 0 };
        const newCount = Math.max(0, (currentCounts[key] || 0) + delta);
        return { ...prev, [dKey]: { ...currentCounts, [key]: newCount } };
    });
};

const copyAndOpenCybozu = () => {
    const todayStr = formatShortDate(new Date());

    let hasPastCounts = false;
    for (let i = 1; i < 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = formatDateKey(d);
        if (matrixCounts[key]) {
            if (Object.values(matrixCounts[key]).some(v => v > 0)) {
                hasPastCounts = true;
                break;
            }
        }
    }

    let newsText = `${todayStr}分\n\n`;

    NEWSPAPERS.forEach(np => {
        newsText += `■${np.label}\n`;
        const dots = [];
        for (let i = 4; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dKey = formatDateKey(date);
            const count = matrixCounts[dKey]?.[np.key] || 0;
            if (count > 0) {
                for (let c = 0; c < count; c++) {
                    if (hasPastCounts) {
                        dots.push(`・（${formatShortDate(date)}）`);
                    } else {
                        dots.push(`・`);
                    }
                }
            }
        }
        if (dots.length > 0) newsText += dots.join('\n') + '\n';
        newsText += '\n';
    });

    const titlesList = clips.map(c => c.title ? `・${c.title}` : null).filter(Boolean).join('\n');
    const copyText = newsText + titlesList;
    copyToClipboardFallback(copyText);
    window.open('https://op7oo.cybozu.com/o/ag.cgi?page=MyFolderMessageView&mid=455345&mdbid=10', '_blank');
};

const createPdfBlob = async (targetClips = clips) => {
    if (!window.PDFLib || targetClips.length === 0) return null;
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.create();
    const A4_WIDTH = 595.28, A4_HEIGHT = 841.89;
    for (const clip of targetClips) {
        const image = await doc.embedJpg(clip.dataUrl);
        const { width: imgW, height: imgH } = image.scale(1.0);
        const isLandscape = imgW > imgH;
        const pageWidth = isLandscape ? A4_HEIGHT : A4_WIDTH;
        const pageHeight = isLandscape ? A4_WIDTH : A4_HEIGHT;
        const page = doc.addPage([pageWidth, pageHeight]);
        const margin = 20;
        const availW = pageWidth - margin * 2, availH = pageHeight - margin * 2;
        const baseScale = Math.min(availW / imgW, availH / imgH);
        const userScale = (clip.scalePercent || 100) / 100;
        const finalScale = baseScale * userScale;
        const drawW = imgW * finalScale, drawH = imgH * finalScale;
        page.drawImage(image, { x: (pageWidth - drawW) / 2, y: (pageHeight - drawH) / 2, width: drawW, height: drawH });
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
};

const downloadPDF = async () => {
    const blob = await createPdfBlob();
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const fileName = outputFileName.trim() || 'merged_document';
    link.download = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    link.click();
};

const downloadSplitPDFs = async () => {
    if (!window.JSZip || clips.length === 0) return;
    const zip = new window.JSZip();
    let clipIndex = 0;

    // 日付別 (4日前 -> 今日)
    for (let i = 4; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dKey = formatDateKey(date);
        const dateStr = formatDate(date); // YYYY.MM.DD

        // 新聞社別
        let dateClips = [];
        for (const np of NEWSPAPERS) {
            const count = matrixCounts[dKey]?.[np.key] || 0;
            if (count > 0) {
                // クリップリストから該当件数分を切り出す
                const slice = clips.slice(clipIndex, clipIndex + count);
                dateClips = [...dateClips, ...slice];
                clipIndex += count;
            }
        }

        if (dateClips.length > 0) {
            const blob = await createPdfBlob(dateClips);
            if (blob) zip.file(`${dateStr}.pdf`, blob);
        }
    }

    // 菴吶▲縺溘け繝ｪ繝・・縺後≠繧後・縲後◎縺ｮ莉悶阪↓蜈･繧後ｋ
    if (clipIndex < clips.length) {
        const extraClips = clips.slice(clipIndex);
        const blob = await createPdfBlob(extraClips);
        if (blob) zip.file(`others_${formatDate(new Date())
            }.pdf`, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `split_pdfs_${formatDate(new Date())}.zip`;
    link.click();
};

const previewPDF = async () => { const blob = await createPdfBlob(); if (blob) setPreviewUrl(URL.createObjectURL(blob)); };
const changePage = (delta) => {
    if (selectedFileIndex === null) return;
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= files[selectedFileIndex].pageCount) { setCurrentPage(newPage); setMasks([]); }
};

const selectFile = (index) => {
    if (editingClipId && !confirm("邱ｨ髮・ｸｭ縺ｧ縺吶らｴ譽・＠縺ｦ蛻･縺ｮ繝輔ぃ繧､繝ｫ繧帝幕縺阪∪縺吶°・・)) return;
        setEditingClipId(null);
    setSelectedFileIndex(index);
    setCurrentPage(1);
    setRotation(0);
    setMasks([]);
    setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    setZoomLevel(1.0);
    setMode('view');
};

const removeMask = (index) => { setMasks(masks.filter((_, i) => i !== index)); };
const removeClip = (id) => { setClips(clips.filter(c => c.id !== id)); if (editingClipId === id) setEditingClipId(null); };
const cancelEdit = () => { setEditingClipId(null); };

const RectHandles = ({ x, y, w, h, color }) => {
    const hs = 1.5;
    return (
        <g fill={color} stroke="white" strokeWidth="1">
            <rect x={`${x * 100 - hs / 2}% `} y={`${y * 100 - hs / 2}% `} width={`${hs}% `} height={`${hs}% `} />
            <rect x={`${(x + w) * 100 - hs / 2}% `} y={`${y * 100 - hs / 2}% `} width={`${hs}% `} height={`${hs}% `} />
            <rect x={`${x * 100 - hs / 2}% `} y={`${(y + h) * 100 - hs / 2}% `} width={`${hs}% `} height={`${hs}% `} />
            <rect x={`${(x + w) * 100 - hs / 2}% `} y={`${(y + h) * 100 - hs / 2}% `} width={`${hs}% `} height={`${hs}% `} />
        </g>
    );
};

return (
    <div className="flex flex-col h-screen bg-gray-100 text-gray-800 font-sans" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onPaste={onPaste}>
        <header className="bg-white shadow px-4 py-3 flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
                <Scissors className="text-blue-600 w-6 h-6" />
                <h1 className="text-xl font-bold text-gray-700">PDF Clipper & Merger</h1>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setSettingsOpen(true)} className="p-2 hover:bg-gray-100 rounded transition" title="險ｭ螳・>
                        <Settings className="w-5 h-5 text-gray-600" />
            </button>
            <label className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded cursor-pointer transition">
                <Upload className="w-4 h-4" /><span className="text-sm">PDF霑ｽ蜉</span>
                <input type="file" multiple accept="application/pdf" className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
            </label>
            <div className="flex gap-1">
                <button onClick={previewPDF} disabled={clips.length === 0} className={`flex items - center gap - 2 px - 4 py - 2 rounded text - blue - 600 border border - blue - 600 font - bold transition ${clips.length > 0 ? 'hover:bg-blue-50' : 'opacity-50 cursor-not-allowed'} `} title="繝励Ξ繝薙Η繝ｼ">
                    <Eye className="w-4 h-4" /><span className="hidden sm:inline">繝励Ξ繝薙Η繝ｼ</span>
                </button>
                <button onClick={downloadSplitPDFs} disabled={clips.length === 0} className={`flex items - center gap - 2 px - 4 py - 2 rounded text - white font - bold transition ${clips.length > 0 ? 'bg-teal-600 hover:bg-teal-700' : 'bg-gray-400 cursor-not-allowed'} `} title="譌･莉倥＃縺ｨ縺ｫ蛻・牡縺励※繝繧ｦ繝ｳ繝ｭ繝ｼ繝・>
                            <Download className="w-4 h-4" />蛻・牡DL
            </button>
            <button onClick={downloadPDF} disabled={clips.length === 0} className={`flex items - center gap - 2 px - 4 py - 2 rounded text - white font - bold transition ${clips.length > 0 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'} `}>
                <FileText className="w-4 h-4" />荳諡ｬPDF
            </button>
    </div>
                </div >
            </header >

    <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div className="flex flex-1 overflow-hidden relative">
            {/* Left Sidebar */}
            <div className={`${leftSidebarOpen ? 'w-64 border-r' : 'w-0 border-none'} bg - white overflow - y - auto flex flex - col flex - shrink - 0 transition - all duration - 300 z - 10`}>
                {/* Matrix Counter */}
                <div className="p-2 bg-gray-50 border-b">
                    <div className="text-xs font-bold text-gray-500 mb-2 px-1">記事数カウンター</div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-center text-xs border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-1 text-left font-normal text-gray-400 w-16"></th>
                                    {[0, 1, 2, 3, 4].map(daysAgo => {
                                        const d = new Date();
                                        d.setDate(d.getDate() - daysAgo);
                                        const isToday = daysAgo === 0;
                                        return (
                                            <th key={daysAgo} className={`p - 1 font - normal border - b min - w - [30px] ${isToday ? 'text-blue-600 font-bold' : 'text-gray-500'} `}>
                                                {formatShortDate(d)}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {NEWSPAPERS.map(np => (
                                    <tr key={np.key} className="border-b last:border-0 bg-white">
                                        <td className="p-1 text-left font-bold text-gray-600 whitespace-nowrap">{np.label.replace('日本', '').replace('経済', '').replace('産経', '')}</td>
                                        {
                                            [0, 1, 2, 3, 4].map(daysAgo => {
                                                const d = new Date();
                                                d.setDate(d.getDate() - daysAgo);
                                                const dKey = formatDateKey(d);
                                                const count = matrixCounts[dKey]?.[np.key] || 0;
                                                return (
                                                    <td
                                                        key={daysAgo}
                                                        className={`p - 1 cursor - pointer select - none hover: bg - blue - 50 transition border - l border - gray - 100 ${count > 0 ? 'text-blue-600 font-bold' : 'text-gray-300'} `}
                                                        onClick={() => updateMatrixCount(d, np.key, 1)}
                                                        onContextMenu={(e) => { e.preventDefault(); updateMatrixCount(d, np.key, -1); }}
                                                    >
                                                        {count > 0 ? count : '-'}
                                                    </td>
                                                );
                                            })
                                        }
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="text-[10px] text-gray-400 mt-1 text-right px-1">左=増 / 右=減</div>
                    </div>

                    <div className="p-3 bg-gray-50 border-b font-semibold text-sm text-gray-500">アップロード済みファイル</div>
                    <div className="flex-1 p-2 space-y-2">
                        {files.map((file, idx) => (
                            <div key={idx} onClick={() => selectFile(idx)} className={`p - 3 rounded cursor - pointer flex items - center gap - 3 transition ${selectedFileIndex === idx ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'} `}>
                                <FileText className={`w - 5 h - 5 ${selectedFileIndex === idx ? 'text-blue-600' : 'text-gray-400'} `} />
                                <div className="overflow-hidden"><div className="text-sm font-medium truncate">{file.name}</div><div className="text-xs text-gray-500">{file.pageCount} pages</div></div>
                            </div>
                        ))}
                        {files.length === 0 && <div className="text-center p-8 text-gray-400 text-sm">PDFをここにドラッグ<br />または貼り付け(Ctrl+V)</div>}
                    </div>
                </div>

                {/* Main Editor */}
                <div className="flex-1 flex flex-col bg-gray-100 relative min-w-0">
                    {/* Sidebar Toggles */}
                    <button
                        onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
                        className="absolute top-1/2 left-0 z-20 transform -translate-y-1/2 bg-white border border-gray-300 rounded-r shadow-md p-1 hover:bg-gray-100 text-gray-500"
                        title={leftSidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
                    >
                        {leftSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <button
                        onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                        className="absolute top-1/2 right-0 z-20 transform -translate-y-1/2 bg-white border border-gray-300 rounded-l shadow-md p-1 hover:bg-gray-100 text-gray-500"
                        title={rightSidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
                    >
                        {rightSidebarOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                    {/* Toolbar */}
                    <div className="h-14 bg-white border-b flex items-center justify-between px-4 gap-4 z-10">
                        <div className="flex items-center gap-1">
                            <button onClick={() => setMode(mode === 'crop' ? 'view' : 'crop')} className={`flex items - center gap - 1 px - 3 py - 1.5 rounded text - sm transition ${mode === 'crop' ? 'bg-green-100 text-green-700 font-bold ring-2 ring-green-500 ring-offset-1' : 'hover:bg-gray-100 text-gray-600'} `}>
                                <Scissors className="w-4 h-4" /> 切り抜き
                            </button>
                            <button onClick={() => setMode(mode === 'mask' ? 'view' : 'mask')} className={`flex items - center gap - 1 px - 3 py - 1.5 rounded text - sm transition ${mode === 'mask' ? 'bg-red-100 text-red-700 font-bold ring-2 ring-red-500 ring-offset-1' : 'hover:bg-gray-100 text-gray-600'} `}>
                                <Eraser className="w-4 h-4" /> 白塗り
                            </button>
                            <div className="w-px h-6 bg-gray-300 mx-2"></div>
                            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded">
                                <button onClick={() => setRotation(r => Number((r - 1).toFixed(1)))} className="p-1 hover:bg-gray-200 rounded" title="-1°"><ChevronLeft className="w-4 h-4 text-gray-600" /></button>
                                <button onClick={() => setRotation(r => Number((r - 0.1).toFixed(1)))} className="px-1 py-0.5 hover:bg-gray-200 rounded text-[10px] font-bold text-gray-600" title="-0.1°">-0.1</button>
                                <div className="w-24 px-2 flex flex-col items-center">
                                    <span className="text-[10px] text-gray-500">{rotation.toFixed(1)}ﾂｰ</span>
                                    <input type="range" min="-180" max="180" step="0.1" value={rotation} onChange={(e) => setRotation(parseFloat(e.target.value))} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer" />
                                </div>
                                <button onClick={() => setRotation(r => Number((r + 0.1).toFixed(1)))} className="px-1 py-0.5 hover:bg-gray-200 rounded text-[10px] font-bold text-gray-600" title="+0.1ﾂｰ">+0.1</button>
                                <button onClick={() => setRotation(r => Number((r + 1).toFixed(1)))} className="p-1 hover:bg-gray-200 rounded" title="+1ﾂｰ"><ChevronRight className="w-4 h-4 text-gray-600" /></button>
                                <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                <button onClick={() => setRotation(r => Number((r + 90).toFixed(1)))} className="p-1 hover:bg-gray-200 rounded" title="+90ﾂｰ"><RefreshCw className="w-4 h-4 text-gray-600" /></button>
                            </div>
                            <div className="flex items-center gap-1 ml-2 bg-gray-100 rounded px-2">
                                <button onClick={() => setZoomLevel(z => Math.max(z - 0.05, 0.5))} className="p-1 hover:text-blue-600"><ZoomOut className="w-4 h-4" /></button>
                                <span className="text-xs w-12 text-center">{Math.round(zoomLevel * 100)}%</span>
                                <button onClick={() => setZoomLevel(z => Math.min(z + 0.05, 3.0))} className="p-1 hover:text-blue-600"><ZoomIn className="w-4 h-4" /></button>
                            </div>
                        </div>
                        {selectedFileIndex !== null && (
                            <div className="flex items-center gap-2 bg-gray-100 px-2 py-1 rounded">
                                <button onClick={() => changePage(-1)} disabled={currentPage <= 1} className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-sm">&lt;</button>
                                <span className="text-xs font-medium whitespace-nowrap px-1">P.{currentPage} / {files[selectedFileIndex].pageCount}</span>
                                <button onClick={() => changePage(1)} disabled={currentPage >= files[selectedFileIndex].pageCount} className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-sm">&gt;</button>
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            {editingClipId && <button onClick={cancelEdit} className="px-3 py-1.5 text-gray-600 text-sm hover:bg-gray-100 rounded">繧ｭ繝｣繝ｳ繧ｻ繝ｫ</button>}
                            <button onClick={saveClip} className={`flex items - center gap - 2 px - 4 py - 1.5 rounded text - sm font - bold shadow - sm transition ${editingClipId ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'} `}>
                                {editingClipId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                {editingClipId ? '譖ｴ譁ｰ縺励※菫晏ｭ・ : '繝ｪ繧ｹ繝医↓霑ｽ蜉'}
                            </button>
                        </div>
                    </div>
                    {editingClipId && <div className="bg-orange-100 text-orange-800 text-xs px-4 py-1 text-center font-bold border-b border-orange-200">繝ｪ繧ｹ繝医い繧､繝・Β縺ｮ蜀咲ｷｨ髮・ｸｭ縺ｧ縺吶・/div>}
                        {/* Canvas */}
                        <div className="flex-1 overflow-auto p-8 flex items-start relative bg-gray-200/50" ref={containerRef}>
                            {selectedFileIndex !== null ? (
                                <div className="relative shadow-lg border border-gray-300 bg-white m-auto">
                                    <canvas ref={canvasRef} className="block" />
                                    <svg className="absolute top-0 left-0 w-full h-full touch-none" style={{ pointerEvents: 'all', cursor: mode === 'view' ? 'default' : (interactionState.type === 'move' ? 'move' : 'default') }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                                        {cropRect.w > 0 && cropRect.h > 0 && (
                                            <>
                                                <rect x={`${cropRect.x * 100}% `} y={`${cropRect.y * 100}% `} width={`${cropRect.w * 100}% `} height={`${cropRect.h * 100}% `} fill="rgba(34, 197, 94, 0.2)" stroke="#22c55e" strokeWidth={mode === 'crop' ? 2 : 1} strokeDasharray="5,5" style={{ pointerEvents: 'none' }} />
                                                {mode === 'crop' && <RectHandles x={cropRect.x} y={cropRect.y} w={cropRect.w} h={cropRect.h} color="#22c55e" />}
                                            </>
                                        )}
                                        {masks.map((m, i) => (
                                            <g key={i}>
                                                <rect x={`${m.x * 100}% `} y={`${m.y * 100}% `} width={`${m.w * 100}% `} height={`${m.h * 100}% `} fill="rgba(239, 68, 68, 0.5)" stroke="#ef4444" strokeWidth="1" style={{ pointerEvents: 'none' }} />
                                                {mode === 'mask' && (
                                                    <>
                                                        <RectHandles x={m.x} y={m.y} w={m.w} h={m.h} color="#ef4444" />
                                                        <line x1={`${m.x * 100}% `} y1={`${m.y * 100}% `} x2={`${(m.x + m.w) * 100}% `} y2={`${(m.y + m.h) * 100}% `} stroke="#ef4444" strokeWidth="1" />
                                                        <line x1={`${(m.x + m.w) * 100}% `} y1={`${m.y * 100}% `} x2={`${m.x * 100}% `} y2={`${(m.y + m.h) * 100}% `} stroke="#ef4444" strokeWidth="1" />
                                                        <g onClick={(e) => { e.stopPropagation(); removeMask(i); }} style={{ cursor: 'pointer', pointerEvents: 'all' }}>
                                                            <circle cx={`${(m.x + m.w) * 100}% `} cy={`${m.y * 100}% `} r="8" fill="red" />
                                                            <text x={`${(m.x + m.w) * 100}% `} y={`${m.y * 100}% `} dy="3" dx="-3" fill="white" fontSize="10" fontWeight="bold">ﾃ・/text>
                                                        </g>
                                                    </>
                                                )}
                                            </g>
                                        ))}
                                    </svg>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-gray-400 m-auto">
                                    <Scissors className="w-16 h-16 mb-4 opacity-20" />
                                    <p>蟾ｦ蛛ｴ縺ｮ繝｡繝九Η繝ｼ縺九ｉPDF繧帝∈謚槭☆繧九°縲・br />繝輔ぃ繧､繝ｫ繧偵ラ繝ｭ繝・・縺励※縺上□縺輔＞</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Sidebar */}
                <div className={`${rightSidebarOpen ? 'w-80 border-l' : 'w-0 border-none'} bg - white flex flex - col z - 20 shadow - lg flex - shrink - 0 transition - all duration - 300`}>
                    <div className="p-3 bg-gray-50 border-b font-semibold text-sm text-gray-500 flex justify-between items-center whitespace-nowrap overflow-hidden">
                        <span>邨仙粋繝ｪ繧ｹ繝・/span>
                            <div className="flex gap-2 items-center">
                                <span className="text-[10px] text-gray-400">AICost: ${totalCost.toFixed(4)}</span>
                                <button onClick={analyzeAllTitles} disabled={clips.length === 0} className="flex items-center gap-1 bg-purple-100 text-purple-600 px-2 py-1 rounded text-xs hover:bg-purple-200 transition disabled:opacity-50" title="縺吶∋縺ｦ縺ｮ繧ｯ繝ｪ繝・・繧但I隗｣譫・>
                                <Sparkles className="w-3 h-3" />荳諡ｬ
                            </button>
                            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">{clips.length}</span>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-6">
                    {clips.map((clip, idx) => (
                            <div key={clip.id} className={`group relative border rounded shadow - sm p - 2 transition ${ editingClipId === clip.id ? 'bg-orange-50 border-orange-300 ring-2 ring-orange-200' : 'bg-gray-50 hover:shadow-md' } `}>
                                <div className="text-xs text-gray-400 mb-2 flex justify-between items-center">
                                    <span>#{idx + 1} {clip.aspectRatio > 1 ? '(讓ｪ)' : '(邵ｦ)'}</span>
                                    <div className="flex gap-1">
                                        <button onClick={() => editClip(clip)} className="text-blue-400 hover:text-blue-600 p-1 hover:bg-blue-50 rounded" title="蜀咲ｷｨ髮・><Edit3 className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => removeClip(clip.id)} className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded" title="蜑企勁"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                </div>
                                <div className="relative bg-white border overflow-hidden rounded flex items-center justify-center h-32 cursor-pointer hover:opacity-90 mb-2" onClick={() => editClip(clip)}>
                                    <img src={clip.dataUrl} className="max-w-full max-h-full object-contain" alt="clip" />
                                    {editingClipId === clip.id && <div className="absolute inset-0 bg-orange-500/10 flex items-center justify-center pointer-events-none"><span className="bg-white/90 text-orange-600 text-xs px-2 py-1 rounded font-bold shadow-sm">邱ｨ髮・ｸｭ</span></div>}
                                </div>
                                <div className="mb-2">
                                    <div className="flex items-center gap-2 mb-1">
                                        <input type="text" className="flex-1 text-xs border rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 outline-none" placeholder="險倅ｺ九ち繧､繝医Ν" value={clip.title || ''} onChange={(e) => updateClipTitle(clip.id, e.target.value)} />
                                        <button onClick={() => analyzeTitleWithAI(clip.id)} disabled={clip.isAnalyzing} className="p-1.5 bg-purple-100 text-purple-600 rounded hover:bg-purple-200 disabled:opacity-50" title="AI縺ｧ繧ｿ繧､繝医Ν謚ｽ蜃ｺ">
                                            {clip.isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span className="whitespace-nowrap">繧ｵ繧､繧ｺ: {clip.scalePercent || 100}%</span>
                                    <input type="range" min="10" max="100" step="5" value={clip.scalePercent || 100} onChange={(e) => updateClipScale(clip.id, e.target.value)} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                </div>
                            </div>
                        ))}
                {clips.length === 0 && <div className="text-center p-6 text-gray-400 text-xs">縲後Μ繧ｹ繝医↓霑ｽ蜉縲阪ｒ謚ｼ縺吶→<br />縺薙％縺ｫ逕ｻ蜒上′霑ｽ蜉縺輔ｌ縺ｾ縺・/div>}
                    </div>
                    <div className="p-4 border-t bg-gray-50 space-y-3">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <input type="date" value={fileDate.toISOString().split('T')[0]} onChange={(e) => e.target.valueAsDate && setFileDate(e.target.valueAsDate)} className="flex-1 px-2 py-1 text-xs border rounded shadow-sm outline-none" />
                            </div>
                            <input type="text" value={fileNamePrefix} onChange={(e) => setFileNamePrefix(e.target.value)} className="w-full px-2 py-1 text-xs border rounded shadow-sm outline-none" placeholder="縲仙・譛我ｺ矩・・ />
                        </div>
                        <div className="flex flex-col gap-2">
                            <button onClick={copyAndOpenCybozu} className="w-full flex items-center justify-center gap-2 py-2.5 rounded text-sm font-bold shadow-sm bg-cyan-600 hover:bg-cyan-700 text-white transition">
                                <ExternalLink className="w-4 h-4" />Cybozu縺ｸ謚慕ｨｿ
                            </button>
                            <button onClick={downloadPDF} disabled={clips.length === 0} className={`w - full py - 2.5 rounded text - sm font - bold shadow - sm transition ${ clips.length > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed' } `}>
                                PDF繧偵ム繧ｦ繝ｳ繝ｭ繝ｼ繝・
                            </button>
                        </div>
                    </div>
                </div>
        </div >

        {/* Settings Modal */}
        {
            settingsOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="font-bold text-gray-700 flex items-center gap-2"><Settings className="w-5 h-5" />險ｭ螳・/h3>
                                <button onClick={() => setSettingsOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">OpenRouter API繧ｭ繝ｼ</label>
                                <div className="flex items-center gap-2">
                                    <Key className="w-4 h-4 text-gray-400" />
                                    <input type="password" value={openRouterApiKey} onChange={(e) => setOpenRouterApiKey(e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="sk-or-..." />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">API繧ｭ繝ｼ縺ｯ繝悶Λ繧ｦ繧ｶ縺ｫ菫晏ｭ倥＆繧後∪縺吶・/p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">AI繝｢繝・Ν</label>
                                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
                                    {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="p-4 border-t flex justify-end gap-2">
                            <button onClick={() => setSettingsOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">繧ｭ繝｣繝ｳ繧ｻ繝ｫ</button>
                            <button onClick={saveSettings} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold">菫晏ｭ・/button>
                        </div>
                    </div>
                </div>
            )
        }

        {/* Preview Modal */}
        {
            previewUrl && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-8">
                    <div className="bg-white rounded-lg w-full h-full max-w-4xl max-h-full flex flex-col shadow-2xl animate-fade-in">
                        <div className="flex justify-between items-center p-3 border-b">
                            <h3 className="font-bold text-gray-700 flex items-center gap-2"><Eye className="w-5 h-5 text-blue-600" />繝励Ξ繝薙Η繝ｼ</h3>
                            <button onClick={() => setPreviewUrl(null)} className="p-1 hover:bg-gray-100 rounded-full transition"><X className="w-6 h-6 text-gray-500" /></button>
                        </div>
                        <div className="flex-1 bg-gray-100 p-2 overflow-hidden">
                            <iframe src={previewUrl} className="w-full h-full rounded border border-gray-300 bg-white" title="PDF Preview" />
                        </div>
                    </div>
                </div>
            )
        }

        {/* AI Result Modal */}
        {
            aiModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]">
                        <div className="flex items-center justify-between p-4 border-b">
                            <div className="flex items-center gap-2 text-purple-600"><Sparkles className="w-5 h-5" /><h3 className="font-bold">AI隗｣譫千ｵ先棡</h3></div>
                            <button onClick={() => setAiModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
                            {isAiLoading ? <div className="flex flex-col items-center justify-center py-12 text-gray-500"><Loader2 className="w-8 h-8 animate-spin mb-2 text-purple-500" /><p>AI縺檎判蜒上ｒ隗｣譫蝉ｸｭ...</p></div> : <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-gray-700">{aiResult}</div>}
                        </div>
                        <div className="p-4 border-t flex justify-end gap-2">
                            <button onClick={copyToClipboard} disabled={isAiLoading || !aiResult} className="flex items-center gap-2 px-3 py-2 bg-white border hover:bg-gray-50 text-gray-700 rounded text-sm transition">
                                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}{copied ? '繧ｳ繝斐・縺励∪縺励◆' : '邨先棡繧偵さ繝斐・'}
                            </button>
                            <button onClick={() => setAiModalOpen(false)} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-bold transition">髢峨§繧・/button>
                        </div>
                    </div>
                </div>
            )
        }
    </div >
    </div >
    );
};

export default PDFClipperApp;

