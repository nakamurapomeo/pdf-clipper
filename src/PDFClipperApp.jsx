import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Scissors, Eraser, Plus, Trash2, FileText, Download, Edit3, Save, Eye, ZoomIn, ZoomOut, Sparkles, ExternalLink, Copy, Loader2, Key, ChevronLeft, ChevronRight, RefreshCw, X, Check, Settings, Minus, Clipboard } from 'lucide-react';


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
const formatFileNameDate = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};
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

const DEFAULT_MODELS = [
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
    { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
];
const NEWSPAPERS = [
    { key: 'agri', label: '日本農業新聞', shortLabel: '農業' },
    { key: 'nikkei', label: '日本経済新聞', shortLabel: '日経' },
    { key: 'mj', label: '日経MJ', shortLabel: 'MJ' },
    { key: 'commercial', label: '商業施設新聞', shortLabel: '商業' }
];

const PDFClipperApp = () => {
    useScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    useScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js');
    useScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

    const [files, setFiles] = useState([]);
    const [selectedFileIndex, setSelectedFileIndex] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [mode, setMode] = useState('crop');
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
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODELS[0].id);
    const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS);
    const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
    const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
    const [interactionState, setInteractionState] = useState({ type: 'none', target: null, index: null });
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [pageThumbnails, setPageThumbnails] = useState([]);
    const [draggedClipId, setDraggedClipId] = useState(null);
    const [editingClipId, setEditingClipId] = useState(null);
    const [explanationPrompt, setExplanationPrompt] = useState('この新聞記事の内容を日本語でわかりやすく解説してください。記事の要点、背景、重要なポイントを簡潔にまとめてください。');
    const [explanationResult, setExplanationResult] = useState('');
    const [isExplaining, setIsExplaining] = useState(false);
    const [cursorStyle, setCursorStyle] = useState('crosshair');

    const canvasRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        const storedKey = localStorage.getItem('openRouterApiKey');
        if (storedKey) setOpenRouterApiKey(storedKey);
        const storedModel = localStorage.getItem('selectedModel');
        if (storedModel) setSelectedModel(storedModel);
        const storedPrompt = localStorage.getItem('explanationPrompt');
        if (storedPrompt) setExplanationPrompt(storedPrompt);

        // OpenRouterからモデルリストを取得
        fetch('https://openrouter.ai/api/v1/models')
            .then(res => res.json())
            .then(data => {
                if (data.data && Array.isArray(data.data)) {
                    // 画像入力対応モデルのみフィルタリング
                    const visionModels = data.data
                        .filter(m => m.architecture?.modality?.includes('image') || m.id.includes('vision') || m.id.includes('gemini') || m.id.includes('gpt-4o') || m.id.includes('claude-3'))
                        .map(m => ({ id: m.id, name: m.name || m.id }))
                        .sort((a, b) => a.name.localeCompare(b.name));
                    if (visionModels.length > 0) setAvailableModels(visionModels);
                }
            })
            .catch(() => { /* エラー時はデフォルトを使用 */ });
    }, []);

    const handleFileUpload = async (uploadedFiles) => {
        if (!window.pdfjsLib) return;
        const newFiles = [];
        for (const file of Array.from(uploadedFiles)) {
            if (file.type !== 'application/pdf') continue;
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise;
            newFiles.push({ name: file.name, data: arrayBuffer, pdf, pageCount: pdf.numPages });
        }
        if (newFiles.length === 0) return;
        const prevFilesLength = files.length;
        setFiles(prev => [...prev, ...newFiles]);
        if (selectedFileIndex === null && newFiles.length > 0) setSelectedFileIndex(prevFilesLength);

        // サムネイル生成
        const thumbnails = [];
        let fileOffset = prevFilesLength;
        for (const file of newFiles) {
            for (let pageNum = 1; pageNum <= file.pageCount; pageNum++) {
                const page = await file.pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 0.2 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                thumbnails.push({
                    fileIndex: fileOffset,
                    pageNum,
                    dataUrl: canvas.toDataURL('image/jpeg', 0.6),
                    fileName: file.name
                });
            }
            fileOffset++;
        }
        setPageThumbnails(prev => [...prev, ...thumbnails]);
    };

    // ドラッグ＆ドロップハンドラ
    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles.length > 0) {
            handleFileUpload(droppedFiles);
        }
    };

    // クリップボードから貼り付け (Ctrl+V)
    const handlePaste = async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type === 'application/pdf') {
                const file = item.getAsFile();
                if (file) await handleFileUpload([file]);
            }
        }
    };

    // クリップボードから貼り付けボタン用
    const handlePasteFromClipboard = async () => {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                if (item.types.includes('application/pdf')) {
                    const blob = await item.getType('application/pdf');
                    const file = new File([blob], 'pasted.pdf', { type: 'application/pdf' });
                    await handleFileUpload([file]);
                }
            }
        } catch (err) {
            alert('PDFの貼り付けに対応していないか、クリップボードにPDFがありません。');
        }
    };

    // Ctrl+Vイベントリスナー
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                handlePaste(e);
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, []);

    // Ctrl+ホイールでPDFビューアのみズーム（ブラウザズームを防止）
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const handleWheel = (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                setZoomLevel(z => Math.max(0.5, Math.min(3, z + delta)));
            }
        };
        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    const renderPage = useCallback(async () => {
        if (selectedFileIndex === null || !files[selectedFileIndex] || !canvasRef.current) return;
        const page = await files[selectedFileIndex].pdf.getPage(currentPage);
        const containerW = containerRef.current?.clientWidth || 800;
        const containerH = containerRef.current?.clientHeight || 600;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = Math.min(containerW / unscaled.width, containerH / unscaled.height) * 0.95 * zoomLevel;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }, [selectedFileIndex, files, currentPage, zoomLevel]);

    useEffect(() => { renderPage(); }, [renderPage]);

    // ページ変更時に切り抜き・白塗りをクリア
    useEffect(() => {
        setCropRect({ x: 0, y: 0, w: 0, h: 0 });
        setMasks([]);
    }, [selectedFileIndex, currentPage]);

    const getMousePos = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    };

    // リサイズハンドルの判定（四隅と四辺）
    const getResizeHandle = (pos, rect) => {
        const threshold = 0.04; // 4%の範囲でハンドルを検出
        const inX = pos.x >= rect.x - threshold && pos.x <= rect.x + rect.w + threshold;
        const inY = pos.y >= rect.y - threshold && pos.y <= rect.y + rect.h + threshold;
        if (!inX || !inY) return null;

        const nearLeft = Math.abs(pos.x - rect.x) < threshold;
        const nearRight = Math.abs(pos.x - (rect.x + rect.w)) < threshold;
        const nearTop = Math.abs(pos.y - rect.y) < threshold;
        const nearBottom = Math.abs(pos.y - (rect.y + rect.h)) < threshold;

        if (nearTop && nearLeft) return 'nw';
        if (nearTop && nearRight) return 'ne';
        if (nearBottom && nearLeft) return 'sw';
        if (nearBottom && nearRight) return 'se';
        if (nearTop) return 'n';
        if (nearBottom) return 's';
        if (nearLeft) return 'w';
        if (nearRight) return 'e';
        return null;
    };

    const handleMouseDown = (e) => {
        e.preventDefault();
        const pos = getMousePos(e);
        const isRightClick = e.button === 2;
        const effectiveMode = isRightClick ? 'mask' : (mode === 'view' ? 'crop' : mode);

        // 既存の切り抜き範囲のリサイズ判定
        if (cropRect.w > 0 && !isRightClick) {
            const handle = getResizeHandle(pos, cropRect);
            if (handle) {
                setInteractionState({ type: 'resize', target: 'crop', handle });
                setStartPos(pos);
                return;
            }
        }

        // 既存の白塗りのリサイズ判定
        if (isRightClick || mode === 'mask') {
            for (let i = masks.length - 1; i >= 0; i--) {
                const handle = getResizeHandle(pos, masks[i]);
                if (handle) {
                    setInteractionState({ type: 'resize', target: 'mask', index: i, handle });
                    setStartPos(pos);
                    return;
                }
            }
        }

        // 新規作成
        setStartPos(pos);
        if (effectiveMode === 'mask') {
            const newMask = { x: pos.x, y: pos.y, w: 0, h: 0 };
            setMasks([...masks, newMask]);
            setInteractionState({ type: 'create', target: 'mask', index: masks.length });
        } else {
            setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
            setInteractionState({ type: 'create', target: 'crop' });
        }
    };


    const handleMouseMove = (e) => {
        const pos = getMousePos(e);

        // カーソル変更（ドラッグ中でないとき）
        if (interactionState.type === 'none') {
            let newCursor = 'crosshair';
            // 切り抜きハンドルチェック
            if (cropRect.w > 0) {
                const handle = getResizeHandle(pos, cropRect);
                if (handle) {
                    if (handle === 'nw' || handle === 'se') newCursor = 'nwse-resize';
                    else if (handle === 'ne' || handle === 'sw') newCursor = 'nesw-resize';
                    else if (handle === 'n' || handle === 's') newCursor = 'ns-resize';
                    else if (handle === 'e' || handle === 'w') newCursor = 'ew-resize';
                }
            }
            // 白塗りハンドルチェック
            for (const m of masks) {
                const handle = getResizeHandle(pos, m);
                if (handle) {
                    if (handle === 'nw' || handle === 'se') newCursor = 'nwse-resize';
                    else if (handle === 'ne' || handle === 'sw') newCursor = 'nesw-resize';
                    else if (handle === 'n' || handle === 's') newCursor = 'ns-resize';
                    else if (handle === 'e' || handle === 'w') newCursor = 'ew-resize';
                    break;
                }
            }
            setCursorStyle(newCursor);
            return;
        }

        if (interactionState.type === 'resize') {
            const handle = interactionState.handle;
            const updateRect = (rect) => {
                let { x, y, w, h } = rect;
                if (handle.includes('w')) { w = (x + w) - pos.x; x = pos.x; }
                if (handle.includes('e')) { w = pos.x - x; }
                if (handle.includes('n')) { h = (y + h) - pos.y; y = pos.y; }
                if (handle.includes('s')) { h = pos.y - y; }
                return { x, y, w: Math.max(0.01, w), h: Math.max(0.01, h) };
            };

            if (interactionState.target === 'crop') {
                setCropRect(updateRect(cropRect));
            } else {
                const newMasks = [...masks];
                newMasks[interactionState.index] = updateRect(masks[interactionState.index]);
                setMasks(newMasks);
            }
        } else {
            const rect = { x: Math.min(startPos.x, pos.x), y: Math.min(startPos.y, pos.y), w: Math.abs(pos.x - startPos.x), h: Math.abs(pos.y - startPos.y) };
            if (interactionState.target === 'mask') {
                const newMasks = [...masks];
                newMasks[interactionState.index] = rect;
                setMasks(newMasks);
            } else {
                setCropRect(rect);
            }
        }
    };

    const handleMouseUp = () => setInteractionState({ type: 'none', target: null, index: null, handle: null });

    // 記事数カウンターに基づく次の日付・新聞を取得
    const getNextDateNewspaper = () => {
        const dateOrder = [4, 3, 2, 1, 0]; // 古い日付から
        const npOrder = ['agri', 'nikkei', 'mj', 'commercial'];

        // 現在のクリップ数を日付・新聞別にカウント
        const clipCounts = {};
        for (const clip of clips) {
            const key = `${clip.date}_${clip.newspaper}`;
            clipCounts[key] = (clipCounts[key] || 0) + 1;
        }

        // カウンター順に当てはめていく
        for (const dayOffset of dateOrder) {
            const d = new Date(Date.now() - dayOffset * 86400000);
            const dateKey = formatDateKey(d);
            const counts = matrixCounts[dateKey] || {};

            for (const np of npOrder) {
                const targetCount = counts[np] || 0;
                const currentCount = clipCounts[`${dateKey}_${np}`] || 0;
                if (currentCount < targetCount) {
                    return { date: dateKey, newspaper: np };
                }
            }
        }
        // デフォルト: 今日の日本農業新聞
        return { date: formatDateKey(new Date()), newspaper: 'agri' };
    };

    const saveClip = async () => {
        if (selectedFileIndex === null || cropRect.w === 0) return;
        const canvas = canvasRef.current;
        const offscreen = document.createElement('canvas');
        const ctx = offscreen.getContext('2d');
        const x = cropRect.x * canvas.width, y = cropRect.y * canvas.height, w = cropRect.w * canvas.width, h = cropRect.h * canvas.height;
        offscreen.width = w; offscreen.height = h;
        ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        // 白塗りを適用
        ctx.fillStyle = 'white';
        for (const mask of masks) {
            const mx = (mask.x - cropRect.x) * canvas.width;
            const my = (mask.y - cropRect.y) * canvas.height;
            const mw = mask.w * canvas.width;
            const mh = mask.h * canvas.height;
            ctx.fillRect(mx, my, mw, mh);
        }
        const dataUrl = offscreen.toDataURL('image/jpeg');
        // カウンターに基づいて自動割り当て
        const { date, newspaper } = getNextDateNewspaper();
        const newClipId = Date.now();
        const newClip = { id: newClipId, dataUrl, title: '', scalePercent: 100, aspectRatio: w / h, date, newspaper };
        setClips(prev => [...prev, newClip]);
        setCropRect({ x: 0, y: 0, w: 0, h: 0 });
        setMasks([]);
        // 自動AI解析を実行
        setTimeout(() => analyzeTitleWithAI(newClipId), 100);
    };

    // 再割り当て: カウンターに基づいてすべてのクリップの日付・新聞を再設定
    const reassignAllClips = () => {
        const dateOrder = [4, 3, 2, 1, 0];
        const npOrder = ['agri', 'nikkei', 'mj', 'commercial'];

        // カウンターからすべての割り当てスロットを順番に生成
        const slots = [];
        for (const dayOffset of dateOrder) {
            const d = new Date(Date.now() - dayOffset * 86400000);
            const dateKey = formatDateKey(d);
            const counts = matrixCounts[dateKey] || {};
            for (const np of npOrder) {
                const count = counts[np] || 0;
                for (let i = 0; i < count; i++) {
                    slots.push({ date: dateKey, newspaper: np });
                }
            }
        }

        // クリップに順番に割り当て
        const newClips = clips.map((clip, idx) => {
            if (idx < slots.length) {
                return { ...clip, date: slots[idx].date, newspaper: slots[idx].newspaper };
            }
            return clip;
        });
        setClips(newClips);
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
                            { type: 'text', text: "この新聞記事の見出し（タイトル）のみを正確に抽出して返してください。文字が読み取れない場合は、画像から推測して答えてください。説明は不要です。" },
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

    const analyzeAllTitles = async () => { for (const c of clips) await analyzeTitleWithAI(c.id); };

    // 全クリップをAIで解説
    const explainAllClips = async () => {
        if (clips.length === 0) return;
        if (!openRouterApiKey) { alert("設定からOpenRouter APIキーを入力してください。"); return; }
        setIsExplaining(true);
        setExplanationResult('');
        try {
            const imageContents = clips.map((c, i) => ({
                type: 'image_url',
                image_url: { url: c.dataUrl }
            }));
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: selectedModel,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: `以下は${clips.length}件の新聞記事の画像です。それぞれについて、${explanationPrompt}\n\n各記事を番号付きで解説してください。` },
                            ...imageContents
                        ]
                    }]
                })
            });
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content?.trim() || "解説を取得できませんでした";
            setExplanationResult(text);
        } catch (e) {
            setExplanationResult(`エラー: ${e.message}`);
        } finally {
            setIsExplaining(false);
        }
    };

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
        const margin = 20;
        for (const clip of targetClips) {
            const img = await doc.embedJpg(clip.dataUrl);
            const scale = clip.scalePercent / 100;
            const imgW = img.width * scale;
            const imgH = img.height * scale;
            const pageW = imgW + margin * 2;
            const pageH = imgH + margin * 2;
            const page = doc.addPage([pageW, pageH]);
            page.drawImage(img, { x: margin, y: margin, width: imgW, height: imgH });
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

    // 日別PDF出力機能
    const downloadDailyPDFs = async () => {
        if (!window.PDFLib || clips.length === 0) {
            alert('クリップがありません。');
            return;
        }
        // 日付でグループ化
        const clipsByDate = {};
        for (const clip of clips) {
            const dateKey = clip.date || formatDateKey(new Date());
            if (!clipsByDate[dateKey]) clipsByDate[dateKey] = [];
            clipsByDate[dateKey].push(clip);
        }
        // 新聞順でソート
        const newspaperOrder = { agri: 0, nikkei: 1, mj: 2, commercial: 3 };
        for (const dateKey in clipsByDate) {
            clipsByDate[dateKey].sort((a, b) => (newspaperOrder[a.newspaper] || 0) - (newspaperOrder[b.newspaper] || 0));
        }
        const dateKeys = Object.keys(clipsByDate).sort();
        if (dateKeys.length === 1) {
            // 1日分のみの場合は直接ダウンロード
            const blob = await createPdfBlob(clipsByDate[dateKeys[0]]);
            if (!blob) return;
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${fileNamePrefix}${formatFileNameDate(dateKeys[0])}.pdf`;
            link.click();
        } else {
            // 複数日の場合はZIPでダウンロード
            if (!window.JSZip) {
                alert('JSZipがロードされていません。');
                return;
            }
            const zip = new window.JSZip();
            for (const dateKey of dateKeys) {
                const blob = await createPdfBlob(clipsByDate[dateKey]);
                if (blob) {
                    zip.file(`${fileNamePrefix}${formatFileNameDate(dateKey)}.pdf`, blob);
                }
            }
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `共有事項_${formatDate(new Date())}.zip`;
            link.click();
        }
    };

    // テキスト生成機能
    const generateShareText = () => {
        if (clips.length === 0) {
            alert('クリップがありません。');
            return '';
        }
        // 日付でグループ化
        const clipsByDate = {};
        for (const clip of clips) {
            const dateKey = clip.date || formatDateKey(new Date());
            if (!clipsByDate[dateKey]) clipsByDate[dateKey] = [];
            clipsByDate[dateKey].push(clip);
        }
        const dateKeys = Object.keys(clipsByDate).sort();
        const todayKey = formatDateKey(new Date());
        const isTodayOnly = dateKeys.length === 1 && dateKeys[0] === todayKey;
        const isSingleDay = dateKeys.length === 1;

        // 日付範囲の計算
        let dateRangeText = '';
        if (!isTodayOnly && isSingleDay) {
            const d = new Date(dateKeys[0]);
            dateRangeText = `${d.getMonth() + 1}/${d.getDate()}`;
        } else if (!isSingleDay) {
            const firstDate = new Date(dateKeys[0]);
            const lastDate = new Date(dateKeys[dateKeys.length - 1]);
            // 月またぎ判定
            if (firstDate.getMonth() === lastDate.getMonth()) {
                dateRangeText = `${firstDate.getMonth() + 1}/${firstDate.getDate()}-${lastDate.getDate()}分`;
            } else {
                dateRangeText = `${firstDate.getMonth() + 1}/${firstDate.getDate()}-${lastDate.getMonth() + 1}/${lastDate.getDate()}分`;
            }
        }

        // 全クリップを新聞別にグループ化
        const clipsByNewspaper = {};
        for (const clip of clips) {
            const np = clip.newspaper || 'agri';
            if (!clipsByNewspaper[np]) clipsByNewspaper[np] = [];
            clipsByNewspaper[np].push(clip);
        }

        let result = '';
        if (dateRangeText) {
            result += dateRangeText + '\n\n';
        }

        for (const np of NEWSPAPERS) {
            const npClips = clipsByNewspaper[np.key];
            if (npClips && npClips.length > 0) {
                result += `■${np.label}\n`;
                for (const clip of npClips) {
                    const d = new Date(clip.date || todayKey);
                    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
                    result += `・${clip.title || '（タイトル未設定）'}（${dateStr}）\n`;
                }
                result += '\n';
            }
        }
        return result.trim();
    };

    const copyShareText = () => {
        const text = generateShareText();
        if (text) copyToClipboardFallback(text);
    };

    const copyAndOpenCybozu = () => {
        const text = generateShareText();
        if (!text) return;
        copyToClipboardFallback(text);
        window.open('https://op7oo.cybozu.com/o/ag.cgi?page=MyFolderMessageView&mid=455345&mdbid=10', '_blank');
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans" onDragOver={handleDragOver} onDrop={handleDrop}>
            <div className="flex flex-1 overflow-hidden">
                <div className={`${leftSidebarOpen ? 'w-64 border-r' : 'w-0'} bg-white transition-all overflow-y-auto overflow-x-hidden flex flex-col`}>
                    <div className="p-3 bg-gray-50 border-b">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">記事数カウンター</div>
                        <table className="w-full text-[10px] border-separate border-spacing-px">
                            <thead><tr><th></th>{[0, 1, 2, 3, 4].map(i => <th key={i} className="pb-1">{formatShortDate(new Date(Date.now() - i * 86400000))}</th>)}</tr></thead>
                            <tbody>{NEWSPAPERS.map(np => (
                                <tr key={np.key}>
                                    <td className="font-bold py-1">{np.shortLabel}</td>
                                    {[0, 1, 2, 3, 4].map(i => {
                                        const d = new Date(Date.now() - i * 86400000);
                                        const count = matrixCounts[formatDateKey(d)]?.[np.key] || 0;
                                        return <td key={i} className={`text-center py-1 cursor-pointer transition-colors rounded ${count > 0 ? 'bg-blue-100 text-blue-700 font-bold' : 'hover:bg-gray-100 text-gray-300'}`} onClick={() => updateMatrixCount(d, np.key, 1)} onContextMenu={(e) => { e.preventDefault(); updateMatrixCount(d, np.key, -1) }}>{count || '-'}</td>
                                    })}
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                    <div className="flex-1 p-2 space-y-1 overflow-y-auto">
                        <div className="text-[10px] font-bold text-gray-400 px-1 mb-2">ページプレビュー ({pageThumbnails.length})</div>
                        <div className="grid grid-cols-1 gap-2">
                            {pageThumbnails.map((thumb, i) => (
                                <div key={i} onClick={() => { setSelectedFileIndex(thumb.fileIndex); setCurrentPage(thumb.pageNum); }} className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${selectedFileIndex === thumb.fileIndex && currentPage === thumb.pageNum ? 'border-blue-500 shadow-lg' : 'border-transparent hover:border-gray-300'}`}>
                                    <img src={thumb.dataUrl} className="w-full h-auto" alt={`${thumb.fileName} P${thumb.pageNum}`} />
                                    <div className="text-[8px] text-center text-gray-500 py-0.5 bg-gray-50 truncate">P{thumb.pageNum}</div>
                                </div>
                            ))}
                        </div>
                        {pageThumbnails.length === 0 && <div className="text-center py-10 text-gray-300 text-xs italic">PDFをアップロードしてください</div>}
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
                            <div className="w-px h-6 bg-gray-200 mx-2"></div>
                            <div className="flex items-center gap-1 bg-gray-50 px-2 rounded-lg">
                                <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="hover:text-blue-600 transition-colors"><Minus size={14} /></button>
                                <span className="text-[10px] font-bold w-10 text-center">{Math.round(zoomLevel * 100)}%</span>
                                <button onClick={() => setZoomLevel(z => Math.min(3, z + 0.1))} className="hover:text-blue-600 transition-colors"><Plus size={14} /></button>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <span className="text-[10px] font-medium text-gray-400 flex items-center">P.{currentPage}/{files[selectedFileIndex]?.pageCount || 1}</span>
                            <button onClick={() => { setCropRect({ x: 0, y: 0, w: 0, h: 0 }); setMasks([]); }} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-all">クリア</button>
                            <button onClick={saveClip} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow-sm transition-all">追加</button>
                            <div className="w-px h-6 bg-gray-200 mx-1"></div>
                            <button onClick={() => setSettingsOpen(true)} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-all"><Settings size={16} /></button>
                            <button onClick={handlePasteFromClipboard} className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 transition-all"><Clipboard size={14} /><span>貼り付け</span></button>
                            <label className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold cursor-pointer hover:bg-blue-700 shadow-sm transition-all">
                                <Upload size={14} /><span>PDF追加</span>
                                <input type="file" multiple accept="application/pdf" className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                            </label>
                        </div>
                    </div>
                    <div ref={containerRef} className="flex-1 overflow-auto p-8 flex justify-center no-scrollbar" onDragOver={handleDragOver} onDrop={handleDrop}>
                        {selectedFileIndex !== null && (
                            <div className="relative bg-white shadow-2xl mx-auto self-start ring-1 ring-black/5" style={{ transform: `rotate(${rotation}deg)` }}>
                                <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onContextMenu={(e) => e.preventDefault()} style={{ cursor: cursorStyle }} />
                                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ transform: `rotate(${-rotation}deg)` }}>
                                    {cropRect.w > 0 && <>
                                        <rect x={`${cropRect.x * 100}%`} y={`${cropRect.y * 100}%`} width={`${cropRect.w * 100}%`} height={`${cropRect.h * 100}%`} fill="rgba(34,197,94,0.15)" stroke="#22c55e" strokeWidth="2" />
                                        {/* リサイズハンドル（四隅） */}
                                        <rect x={`calc(${cropRect.x * 100}% - 4px)`} y={`calc(${cropRect.y * 100}% - 4px)`} width="8" height="8" fill="#22c55e" />
                                        <rect x={`calc(${(cropRect.x + cropRect.w) * 100}% - 4px)`} y={`calc(${cropRect.y * 100}% - 4px)`} width="8" height="8" fill="#22c55e" />
                                        <rect x={`calc(${cropRect.x * 100}% - 4px)`} y={`calc(${(cropRect.y + cropRect.h) * 100}% - 4px)`} width="8" height="8" fill="#22c55e" />
                                        <rect x={`calc(${(cropRect.x + cropRect.w) * 100}% - 4px)`} y={`calc(${(cropRect.y + cropRect.h) * 100}% - 4px)`} width="8" height="8" fill="#22c55e" />
                                    </>}
                                    {masks.map((m, i) => <React.Fragment key={i}>
                                        <rect x={`${m.x * 100}%`} y={`${m.y * 100}%`} width={`${m.w * 100}%`} height={`${m.h * 100}%`} fill="rgba(239,68,68,0.3)" />
                                        <rect x={`calc(${m.x * 100}% - 3px)`} y={`calc(${m.y * 100}% - 3px)`} width="6" height="6" fill="#ef4444" />
                                        <rect x={`calc(${(m.x + m.w) * 100}% - 3px)`} y={`calc(${m.y * 100}% - 3px)`} width="6" height="6" fill="#ef4444" />
                                        <rect x={`calc(${m.x * 100}% - 3px)`} y={`calc(${(m.y + m.h) * 100}% - 3px)`} width="6" height="6" fill="#ef4444" />
                                        <rect x={`calc(${(m.x + m.w) * 100}% - 3px)`} y={`calc(${(m.y + m.h) * 100}% - 3px)`} width="6" height="6" fill="#ef4444" />
                                    </React.Fragment>)}
                                </svg>
                            </div>
                        )}
                    </div>
                </div>
                <div className={`${rightSidebarOpen ? 'w-72 border-l' : 'w-0'} bg-white transition-all overflow-y-auto flex flex-col`} onDragOver={handleDragOver} onDrop={handleDrop}>
                    <div className="p-4 bg-gray-50 border-b font-extrabold text-sm flex justify-between">結合リスト <span className="text-blue-600">{clips.length}</span></div>
                    <div className="p-3 bg-gray-50 border-b space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={analyzeAllTitles} disabled={clips.length === 0} className="py-1.5 bg-purple-600 text-white rounded-lg text-[10px] font-bold hover:opacity-90 disabled:opacity-30 transition-all">AI解析</button>
                            <button onClick={reassignAllClips} disabled={clips.length === 0} className="py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-bold hover:opacity-90 disabled:opacity-30 transition-all">再割り当て</button>
                            <button onClick={copyShareText} disabled={clips.length === 0} className="py-1.5 bg-green-600 text-white rounded-lg text-[10px] font-bold hover:opacity-90 disabled:opacity-30 transition-all">コピー</button>
                            <button onClick={downloadDailyPDFs} disabled={clips.length === 0} className="py-1.5 bg-orange-600 text-white rounded-lg text-[10px] font-bold hover:opacity-90 disabled:opacity-30 transition-all">日別PDF</button>
                            <button onClick={copyAndOpenCybozu} disabled={clips.length === 0} className="py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:opacity-90 disabled:opacity-30 transition-all">Cybozu</button>
                            <button onClick={explainAllClips} disabled={clips.length === 0 || isExplaining} className="py-1.5 bg-pink-600 text-white rounded-lg text-[10px] font-bold hover:opacity-90 disabled:opacity-30 transition-all">{isExplaining ? '解説中...' : 'AI解説'}</button>
                        </div>
                        {explanationResult && (
                            <div className="mt-2 p-2 bg-white rounded-lg border text-xs text-gray-700 max-h-40 overflow-y-auto whitespace-pre-wrap">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="font-bold text-pink-600">AI解説結果</span>
                                    <button onClick={() => { copyToClipboardFallback(explanationResult); }} className="text-[10px] text-blue-600 hover:underline">コピー</button>
                                </div>
                                {explanationResult}
                            </div>
                        )}
                    </div>
                    <div className="flex-1 p-3 space-y-4">
                        {clips.map((c, idx) => (
                            <div key={c.id} draggable onDragStart={() => setDraggedClipId(c.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length > 0) { handleFileUpload(e.dataTransfer.files); return; } if (draggedClipId && draggedClipId !== c.id) { const fromIdx = clips.findIndex(x => x.id === draggedClipId); const toIdx = idx; const newClips = [...clips]; const [moved] = newClips.splice(fromIdx, 1); newClips.splice(toIdx, 0, moved); setClips(newClips); } setDraggedClipId(null); }} className={`p-3 border rounded-xl bg-white shadow-sm space-y-3 hover:shadow-md transition-shadow ring-1 ring-black/5 cursor-grab ${draggedClipId === c.id ? 'opacity-50' : ''}`}>
                                <div className="relative aspect-video bg-gray-50 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer" onClick={() => setEditingClipId(c.id)}>
                                    <img src={c.dataUrl} className="max-w-full max-h-full object-contain" alt="clip" />
                                    <button onClick={(e) => { e.stopPropagation(); setClips(clips.filter(x => x.id !== c.id)); }} className="absolute top-1 right-1 p-1 bg-white/80 rounded-full text-red-500 hover:bg-red-50 shadow-sm"><X size={14} /></button>
                                </div>
                                <div className="flex gap-2">
                                    <input value={c.title} onChange={(e) => setClips(clips.map(x => x.id === c.id ? { ...x, title: e.target.value } : x))} className="flex-1 text-xs border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-100 outline-none" placeholder="記事タイトル..." />
                                    <button onClick={() => analyzeTitleWithAI(c.id)} className="p-2 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors shadow-sm">{c.isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}</button>
                                </div>
                                <div className="flex gap-2">
                                    <select value={c.date || formatDateKey(new Date())} onChange={(e) => setClips(clips.map(x => x.id === c.id ? { ...x, date: e.target.value } : x))} className="flex-1 text-[10px] border rounded-lg px-2 py-1 outline-none bg-white">
                                        {[0, 1, 2, 3, 4].map(i => {
                                            const d = new Date(Date.now() - i * 86400000);
                                            const key = formatDateKey(d);
                                            return <option key={key} value={key}>{formatShortDate(d)}</option>;
                                        })}
                                    </select>
                                    <select value={c.newspaper || 'agri'} onChange={(e) => setClips(clips.map(x => x.id === c.id ? { ...x, newspaper: e.target.value } : x))} className="flex-1 text-[10px] border rounded-lg px-2 py-1 outline-none bg-white">
                                        {NEWSPAPERS.map(np => <option key={np.key} value={np.key}>{np.label}</option>)}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                    <span>サイズ: {c.scalePercent}%</span>
                                    <input type="range" min="10" max="100" value={c.scalePercent} onChange={(e) => setClips(clips.map(x => x.id === c.id ? { ...x, scalePercent: parseInt(e.target.value) } : x))} className="flex-1 h-1 bg-gray-100 appearance-none rounded-full cursor-pointer accent-blue-500" />
                                </div>
                            </div>
                        ))}
                        {clips.length === 0 && <div className="text-center py-20 text-gray-300 text-xs italic">クリップを追加してください</div>}
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
                                    {availableModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-400 mb-2 block uppercase tracking-wider">AI解説プロンプト</label>
                                <textarea value={explanationPrompt} onChange={(e) => setExplanationPrompt(e.target.value)} className="w-full p-3 bg-gray-50 border rounded-xl text-sm focus:ring-4 focus:ring-blue-50 outline-none transition-all resize-none" rows={3} placeholder="記事の解説方法を指定..." />
                                <p className="text-[10px] text-gray-400 mt-2">※AI解説ボタンで使用されるプロンプトです。</p>
                            </div>
                        </div>
                        <button onClick={() => { localStorage.setItem('openRouterApiKey', openRouterApiKey); localStorage.setItem('selectedModel', selectedModel); localStorage.setItem('explanationPrompt', explanationPrompt); setSettingsOpen(false) }} className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95">保存して閉じる</button>
                    </div>
                </div>
            )}
            {editingClipId && (() => {
                const clip = clips.find(c => c.id === editingClipId);
                if (!clip) return null;
                return (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 z-50" onClick={() => setEditingClipId(null)}>
                        <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
                            <div className="p-4 border-b flex justify-between items-center">
                                <h3 className="font-bold text-lg">クリップ編集</h3>
                                <button onClick={() => setEditingClipId(null)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
                            </div>
                            <div className="p-6 flex flex-col md:flex-row gap-6">
                                <div className="flex-1 bg-gray-100 rounded-xl p-4 flex items-center justify-center">
                                    <img src={clip.dataUrl} className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg" alt="clip" />
                                </div>
                                <div className="w-full md:w-72 space-y-4">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 block mb-1">タイトル</label>
                                        <input value={clip.title} onChange={(e) => setClips(clips.map(x => x.id === clip.id ? { ...x, title: e.target.value } : x))} className="w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-100" placeholder="記事タイトル..." />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 block mb-1">日付</label>
                                        <select value={clip.date || formatDateKey(new Date())} onChange={(e) => setClips(clips.map(x => x.id === clip.id ? { ...x, date: e.target.value } : x))} className="w-full text-sm border rounded-lg px-3 py-2 outline-none bg-white">
                                            {[0, 1, 2, 3, 4].map(i => { const d = new Date(Date.now() - i * 86400000); const key = formatDateKey(d); return <option key={key} value={key}>{formatShortDate(d)}</option>; })}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 block mb-1">新聞</label>
                                        <select value={clip.newspaper || 'agri'} onChange={(e) => setClips(clips.map(x => x.id === clip.id ? { ...x, newspaper: e.target.value } : x))} className="w-full text-sm border rounded-lg px-3 py-2 outline-none bg-white">
                                            {NEWSPAPERS.map(np => <option key={np.key} value={np.key}>{np.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 block mb-1">サイズ: {clip.scalePercent}%</label>
                                        <input type="range" min="10" max="100" value={clip.scalePercent} onChange={(e) => setClips(clips.map(x => x.id === clip.id ? { ...x, scalePercent: parseInt(e.target.value) } : x))} className="w-full h-2 bg-gray-200 appearance-none rounded-full cursor-pointer accent-blue-500" />
                                    </div>
                                    <button onClick={() => analyzeTitleWithAI(clip.id)} className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-bold hover:bg-purple-700 transition-all flex items-center justify-center gap-2">
                                        {clip.isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                        AI解析
                                    </button>
                                    <button onClick={() => { setClips(clips.filter(x => x.id !== clip.id)); setEditingClipId(null); }} className="w-full py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600 transition-all">削除</button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
export default PDFClipperApp;
