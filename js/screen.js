// ==========================================
// screen.js — 投屏管理
// ==========================================
let currentScreenStream = null;
let outgoingScreenCalls = [];
let incomingScreenCall = null;
let currentScreenQuality = 'auto';
let screenQualityLabel = 'auto';
let screenVideoSenders = {};  // { peerId: RTCRtpSender }
let screenQualityMonitor = null;

async function toggleShare() {
    if (currentScreenStream) return stopSharing();
    if (Object.keys(meshPeers).length === 0) return alert("网络中没有其他人！");

    const quality = document.getElementById('video-quality')?.value || 'auto';
    currentScreenQuality = quality;
    screenQualityLabel = document.getElementById('video-quality')?.selectedOptions?.[0]?.text || quality;
    const preset = CONFIG.VIDEO_QUALITY[quality] || CONFIG.VIDEO_QUALITY['auto'];
    const constraints = {
        video: { ...preset, cursor: "always" },
        audio: { systemAudio: "include", echoCancellation: true }
    };

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        currentScreenStream = stream;

        const shareBtn = document.getElementById('share-btn');
        if (shareBtn) {
            shareBtn.innerText = "停止投屏";
            shareBtn.classList.replace("btn-primary", "btn-danger");
        }

        // 向所有节点广播
        outgoingScreenCalls = [];
        screenVideoSenders = {};
        Object.keys(meshPeers).forEach(pid => {
            const c = peer.call(pid, stream, { metadata: { type: 'screen', quality: currentScreenQuality, qualityLabel: screenQualityLabel } });
            outgoingScreenCalls.push(c);
            // 轮询获取 PC 用于诊断 + 追踪 video sender
            let att = 0;
            const iv = setInterval(() => {
                att++;
                if (c.peerConnection && typeof trackPeerConnection === 'function') {
                    clearInterval(iv);
                    trackPeerConnection(pid, c.peerConnection);
                    // 追踪 video sender 用于动态画质调节
                    const senders = c.peerConnection.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    if (videoSender) screenVideoSenders[pid] = videoSender;
                } else if (att > 20) {
                    clearInterval(iv);
                }
            }, 300);
        });

        if (currentScreenQuality === 'auto') startScreenQualityMonitor();

        stream.getVideoTracks().forEach(track => {
            track.onended = stopSharing;
        });
    } catch (err) {
        if (err.name !== 'NotAllowedError') alert("屏幕捕获失败");
    }
}

function stopSharing() {
    stopScreenQualityMonitor();
    if (currentScreenStream) {
        currentScreenStream.getTracks().forEach(t => t.stop());
        currentScreenStream = null;
    }
    outgoingScreenCalls.forEach(c => { try { c.close(); } catch (e) {} });
    outgoingScreenCalls = [];
    screenVideoSenders = {};

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.innerText = "发起投屏";
        shareBtn.classList.replace("btn-danger", "btn-primary");
        shareBtn.disabled = false;
    }
}

function hangUpScreen() {
    if (incomingScreenCall) {
        try { incomingScreenCall.close(); } catch (e) {}
        incomingScreenCall = null;
    }
    teardownScreenGestures();

    const videoContainer = document.getElementById('video-container');
    const remoteVideo = document.getElementById('remote-video');
    if (videoContainer) videoContainer.style.display = 'none';
    if (remoteVideo) {
        if (remoteVideo._resCheck) { clearInterval(remoteVideo._resCheck); remoteVideo._resCheck = null; }
        remoteVideo.srcObject = null;
    }
    const qBadge = document.getElementById('screen-quality-badge');
    if (qBadge) qBadge.style.display = 'none';

    // 恢复画质选择器显示（接收方结束观看后）
    const qSelect = document.getElementById('video-quality');
    if (qSelect) qSelect.style.display = '';

    const hangupBtn = document.getElementById('hangup-btn');
    if (hangupBtn) hangupBtn.style.display = 'none';

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.disabled = false;
        shareBtn.innerText = "发起投屏";
        shareBtn.style.opacity = "1";
    }
}

// ==========================================
// 投屏音频回放 — 通过 AudioContext 保真播放
// ==========================================
let screenAudioCtx = null;
let screenAudioGain = null;

function setupScreenAudio(audioStream) {
    teardownScreenAudio();
    try {
        screenAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = screenAudioCtx.createMediaStreamSource(audioStream);
        screenAudioGain = screenAudioCtx.createGain();
        screenAudioGain.gain.value = 1.0;
        source.connect(screenAudioGain);
        screenAudioGain.connect(screenAudioCtx.destination);
        debugLog('screen', '投屏音频已建立 AudioContext 回放');
    } catch (e) {
        debugLog('screen', '投屏音频建立失败:', e);
    }
}

function teardownScreenAudio() {
    if (screenAudioCtx) {
        try { screenAudioCtx.close(); } catch (e) {}
        screenAudioCtx = null;
        screenAudioGain = null;
    }
}

// ==========================================
// 投屏手势控制 (移动端/平板)
// 左 1/3: 亮度  右 1/3: 音量  中间 1/3: 留给系统控件
// ==========================================
let screenGestureState = { active: false, side: null, startY: 0, startValue: 0, currentValue: 0 };
let screenBrightnessOverlay = null;
let screenGestureIndicator = null;
let screenBrightness = 1;

function initScreenGestures() {
    const container = document.getElementById('video-container');
    if (!container) return;

    if (!screenBrightnessOverlay) {
        screenBrightnessOverlay = document.createElement('div');
        screenBrightnessOverlay.id = 'screen-brightness-overlay';
        container.appendChild(screenBrightnessOverlay);
    }
    if (!screenGestureIndicator) {
        screenGestureIndicator = document.createElement('div');
        screenGestureIndicator.id = 'screen-gesture-indicator';
        container.appendChild(screenGestureIndicator);
    }

    container.addEventListener('touchstart', onScreenGestureStart, { passive: false });
    container.addEventListener('touchmove', onScreenGestureMove, { passive: false });
    container.addEventListener('touchend', onScreenGestureEnd);
    container.addEventListener('touchcancel', onScreenGestureEnd);
}

function teardownScreenGestures() {
    const container = document.getElementById('video-container');
    if (!container) return;
    container.removeEventListener('touchstart', onScreenGestureStart);
    container.removeEventListener('touchmove', onScreenGestureMove);
    container.removeEventListener('touchend', onScreenGestureEnd);
    container.removeEventListener('touchcancel', onScreenGestureEnd);

    screenGestureState.active = false;
    if (screenBrightnessOverlay) {
        screenBrightnessOverlay.style.backgroundColor = '';
    }
    if (screenGestureIndicator) {
        screenGestureIndicator.style.opacity = '0';
    }
}

function onScreenGestureStart(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const container = document.getElementById('video-container');
    const rect = container.getBoundingClientRect();
    // 跳过底部控件区域
    if (touch.clientY - rect.top > rect.height * 0.85) return;

    e.preventDefault();
    const relX = touch.clientX - rect.left;
    const third = rect.width / 3;
    let side = null;
    if (relX < third) side = 'left';
    else if (relX > third * 2) side = 'right';
    // 中间 1/3 留给系统控件 (全屏、音量等)，不处理
    if (!side) return;

    screenGestureState.active = true;
    screenGestureState.side = side;
    screenGestureState.startY = touch.clientY;
    const rv0 = document.getElementById('remote-video');
    screenGestureState.startValue = side === 'left' ? screenBrightness : (rv0 ? rv0.volume : 1);
    screenGestureState.currentValue = screenGestureState.startValue;
}

function onScreenGestureMove(e) {
    if (!screenGestureState.active || e.touches.length !== 1) return;
    e.preventDefault();

    const touch = e.touches[0];
    const container = document.getElementById('video-container');
    const rect = container.getBoundingClientRect();
    const deltaY = screenGestureState.startY - touch.clientY;
    const range = Math.max(rect.height * 0.7, 200);
    const delta = deltaY / range;

    let newValue = Math.max(0, Math.min(1, screenGestureState.startValue + delta));
    screenGestureState.currentValue = newValue;

    if (screenGestureState.side === 'left') {
        screenBrightness = newValue;
        if (screenBrightnessOverlay) {
            screenBrightnessOverlay.style.backgroundColor = `rgba(0,0,0,${(1 - newValue) * 0.85})`;
        }
    } else {
        const rv = document.getElementById('remote-video');
        if (rv) rv.volume = newValue;
    }

    if (screenGestureIndicator) {
        const pct = Math.round(newValue * 100);
        const icon = screenGestureState.side === 'left' ? '☀️' : '🔊';
        screenGestureIndicator.textContent = `${icon} ${pct}%`;
        screenGestureIndicator.style.opacity = '1';
        screenGestureIndicator.style.left = screenGestureState.side === 'left' ? '16%' : '84%';
    }
}

function onScreenGestureEnd(e) {
    screenGestureState.active = false;
    setTimeout(() => {
        if (!screenGestureState.active && screenGestureIndicator) {
            screenGestureIndicator.style.opacity = '0';
        }
    }, 600);
}

// ==========================================
// 动态画质调节 (auto 模式)
// ==========================================
function startScreenQualityMonitor() {
    if (screenQualityMonitor) return;
    screenQualityMonitor = setInterval(() => {
        applyDynamicQuality();
    }, 5000);
}

function stopScreenQualityMonitor() {
    if (screenQualityMonitor) {
        clearInterval(screenQualityMonitor);
        screenQualityMonitor = null;
    }
}

// 监听画质选择器变化 — 热生效（分享中即时切换）
function initQualitySelector() {
    const sel = document.getElementById('video-quality');
    if (!sel) return;
    sel.addEventListener('change', () => {
        currentScreenQuality = sel.value;
        screenQualityLabel = sel.selectedOptions[0]?.text || sel.value;

        if (currentScreenQuality === 'auto') {
            startScreenQualityMonitor();
            applyDynamicQuality();
        } else {
            stopScreenQualityMonitor();
            const preset = CONFIG.VIDEO_QUALITY[currentScreenQuality] || CONFIG.VIDEO_QUALITY['auto'];
            applyQualityToSenders(preset, false);
        }
        debugLog('screen', '画质热切换→', screenQualityLabel);
    });
}

// 从所有 outgoing 通话的 PC 获取 video sender 并应用质量参数
function getActiveVideoSenders() {
    const result = [];
    outgoingScreenCalls.forEach(c => {
        if (!c.peerConnection) return;
        try {
            const senders = c.peerConnection.getSenders();
            const vs = senders.find(s => s.track && s.track.kind === 'video');
            if (vs && vs.track.readyState !== 'ended') {
                result.push({ peerId: c.peer, sender: vs });
                // 同步更新缓存
                screenVideoSenders[c.peer] = vs;
            }
        } catch (e) { /* PC 可能已关闭 */ }
    });
    return result;
}

// 将质量参数应用到所有 video sender
function applyQualityToSenders(preset, isAuto) {
    const senders = getActiveVideoSenders();
    if (senders.length === 0) {
        debugLog('screen', 'applyQualityToSenders: 无活跃 sender（重试中...）');
        return;
    }

    const maxH = preset.height?.max || preset.height?.ideal || 1080;
    let maxBitrate;
    if (maxH >= 1080) maxBitrate = 4000000;
    else if (maxH >= 720) maxBitrate = 2000000;
    else maxBitrate = 800000;

    senders.forEach(({ peerId, sender }) => {
        try {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            if (!params.encodings[0]) params.encodings[0] = {};
            params.encodings[0].maxBitrate = maxBitrate;
            if (isAuto) {
                delete params.encodings[0].scaleResolutionDownBy;
            } else {
                delete params.encodings[0].scaleResolutionDownBy;
            }
            sender.setParameters(params).then(() => {
                debugLog('screen', '画质已应用→', peerId, 'maxBitrate:', (maxBitrate/1000)+'kbps');
            }).catch(err => {
                debugLog('screen', 'setParameters 失败→', peerId, err);
            });
        } catch (e) {
            debugLog('screen', 'getParameters 失败→', peerId, e);
        }
    });
}

// 将固定画质预设应用到所有 video sender（兼容旧调用）
function applyFixedQuality(preset) {
    applyQualityToSenders(preset, false);
}

function applyDynamicQuality() {
    if (currentScreenQuality !== 'auto') return;
    const senders = getActiveVideoSenders();
    if (senders.length === 0) return;

    senders.forEach(({ peerId, sender }) => {
        const diag = typeof peerDiagData !== 'undefined' ? peerDiagData[peerId] : null;
        const level = evalNetworkLevel(diag);
        const prevLevel = sender._qualityLevel || 'good';
        if (level === prevLevel) return;
        sender._qualityLevel = level;

        const config = {
            good:    { maxBitrate: 4000000, scale: 1 },
            medium:  { maxBitrate: 1500000, scale: 1.5 },
            poor:    { maxBitrate: 500000,  scale: 2 }
        }[level];

        try {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            if (!params.encodings[0]) params.encodings[0] = {};
            params.encodings[0].maxBitrate = config.maxBitrate;
            params.encodings[0].scaleResolutionDownBy = config.scale;
            sender.setParameters(params).catch(() => {});
            debugLog('screen', '动态画质:', peerId, '→', level, config.maxBitrate / 1000 + 'kbps');
        } catch (e) { /* 忽略 */ }
    });
}

function evalNetworkLevel(diag) {
    if (!diag) return 'good';
    const rtt = diag.rtt ? parseInt(diag.rtt) : null;
    const isRelay = diag.connectionType === 'relay';
    const lost = diag.audioPacketsLost || 0;

    if (isRelay && rtt && rtt > 200) return 'poor';
    if (isRelay && rtt && rtt > 100) return 'medium';
    if (rtt && rtt > 300) return 'poor';
    if (rtt && rtt > 150) return 'medium';
    if (lost > 50) return 'poor';
    if (lost > 10) return 'medium';
    return 'good';
}
