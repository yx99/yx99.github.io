// ==========================================
// app.js — 应用入口，模块初始化与事件绑定
// ==========================================

(function () {
    'use strict';

    // 1. 初始化 UI (用户名等)
    initUI();

    // 2. 初始化 PeerJS 信令
    peerEvents.onOpen = function (id) {
        updateMyIdentityUI();
        updateTopBarStatus();

        // 信令连接后即启动本机 IP 发现
        initConnectionDiagnostics().then(() => {
            debugLog('app', '连接诊断已就绪');
        });
    };

    peerEvents.onConnection = function (conn) {
        setupDataConn(conn);

        // 获取底层 RTCPeerConnection 用于诊断
        setTimeout(() => {
            if (conn.peerConnection) {
                trackPeerConnection(conn.peer, conn.peerConnection);
            }
        }, 500);
    };

    peerEvents.onCall = function (call) {
        const type = call.metadata?.type || 'screen';

        if (type === 'voice') {
            if (!inVoiceRoom) return call.close();

            const callerName = call.metadata.name || '未知';
            if (!meshPeers[call.peer]) meshPeers[call.peer] = { name: callerName };
            meshPeers[call.peer].voiceCall = call;

            call.answer(processedAudioStream);
            call.on('stream', stream => setupRemoteAudioUI(call.peer, callerName, stream));
            call.on('close', () => removeRemoteAudioUI(call.peer));

            // 诊断跟踪
            if (call.peerConnection) {
                trackPeerConnection(call.peer, call.peerConnection);
            }
        } else {
            // 投屏接入
            incomingScreenCall = call;
            call.answer();
            call.on('stream', stream => {
                const videoContainer = document.getElementById('video-container');
                const remoteVideo = document.getElementById('remote-video');
                if (videoContainer) videoContainer.style.display = 'flex';
                if (remoteVideo) remoteVideo.srcObject = stream;

                const hangupBtn = document.getElementById('hangup-btn');
                if (hangupBtn) hangupBtn.style.display = 'inline-block';

                const shareBtn = document.getElementById('share-btn');
                if (shareBtn) { shareBtn.disabled = true; shareBtn.innerText = "观看中"; shareBtn.style.opacity = "0.5"; }
            });
            call.on('close', hangUpScreen);
        }
    };

    // Mesh 网络事件
    meshEvents.onPeerJoin = function (peerId, name) {
        showToast(`${name} 加入了频道`, 'info');
    };

    meshEvents.onPeerLeave = function (peerId, name) {
        showToast(`${name} 离开了频道`, 'info');
    };

    meshEvents.onRoomDisband = function () {
        showToast('房间已被解散', 'warning');
    };

    meshEvents.onMeshChange = function () {
        renderLocalNetInfo();
    };

    // 3. 启动 PeerJS
    initPeerSystem();

    debugLog('app', '应用初始化完成');
})();
