// ==========================================
// screen.js — 投屏管理
// ==========================================
let currentScreenStream = null;
let outgoingScreenCalls = [];
let incomingScreenCall = null;

async function toggleShare() {
    if (currentScreenStream) return stopSharing();
    if (Object.keys(meshPeers).length === 0) return alert("网络中没有其他人！");

    const quality = document.getElementById('video-quality')?.value || 'auto';
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
        Object.keys(meshPeers).forEach(pid => {
            const c = peer.call(pid, stream, { metadata: { type: 'screen' } });
            outgoingScreenCalls.push(c);
            // 轮询获取 PC 用于诊断
            let att = 0;
            const iv = setInterval(() => {
                att++;
                if (c.peerConnection && typeof trackPeerConnection === 'function') {
                    clearInterval(iv);
                    trackPeerConnection(pid, c.peerConnection);
                } else if (att > 20) {
                    clearInterval(iv);
                }
            }, 300);
        });

        stream.getVideoTracks()[0].onended = stopSharing;
    } catch (err) {
        if (err.name !== 'NotAllowedError') alert("屏幕捕获失败");
    }
}

function stopSharing() {
    if (currentScreenStream) {
        currentScreenStream.getTracks().forEach(t => t.stop());
        currentScreenStream = null;
    }
    outgoingScreenCalls.forEach(c => { try { c.close(); } catch (e) {} });
    outgoingScreenCalls = [];

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
    if (remoteVideo) remoteVideo.srcObject = null;

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
// 左半屏: 亮度  右半屏: 音量
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
    const isLeft = (touch.clientX - rect.left) < rect.width / 2;

    screenGestureState.active = true;
    screenGestureState.side = isLeft ? 'left' : 'right';
    screenGestureState.startY = touch.clientY;
    const rv0 = document.getElementById('remote-video');
    screenGestureState.startValue = isLeft ? screenBrightness : (rv0 ? rv0.volume : 1);
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
        screenGestureIndicator.style.left = screenGestureState.side === 'left' ? '25%' : '75%';
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
