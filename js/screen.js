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
            outgoingScreenCalls.push(peer.call(pid, stream, { metadata: { type: 'screen' } }));
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
