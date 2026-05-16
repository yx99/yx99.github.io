// ==========================================
// mesh.js — Mesh 网络管理 (DataConnection)
// ==========================================
let meshPeers = {}; // { peerId: { name, dataConn, voiceCall, screenCall } }

// 回调
const meshEvents = {
    onPeerJoin: null,      // (peerId, name)
    onPeerLeave: null,     // (peerId, name)
    onChatMessage: null,   // (user, text)
    onSystemMessage: null, // (text)
    onRoomDisband: null,
    onMeshChange: null     // 网络拓扑变化
};

// 主动加入别人的房间
function connectToMesh() {
    const targetId = document.getElementById('target-id').value.trim();
    if (!targetId) return alert("请输入目标 ID");
    if (!peer || !peer.id) return alert("信令服务器未连接，请稍后再试");
    if (targetId === peer.id) return alert("不能连接自己的 ID");
    if (meshPeers[targetId]) return alert("已在网中");

    setHost(false);
    setRoomId(targetId);

    const conn = peer.connect(targetId);
    setupDataConn(conn);
    document.getElementById('target-id').value = '';
}

// 断开与解散
function disconnectMesh() {
    if (amIHost()) {
        if (!confirm("您是房主，确定要解散房间吗？所有人将被强制断开。")) return;
        broadcastData({ type: 'room-disband' });
    } else {
        if (!confirm("确定要离开当前房间吗？")) return;
    }
    executeDisconnect();
}

function executeDisconnect() {
    if (typeof toggleVoiceRoom === 'function' && window._inVoiceRoom) toggleVoiceRoom();
    if (typeof currentScreenStream !== 'undefined' && currentScreenStream) stopSharing();

    Object.keys(meshPeers).forEach(pid => {
        if (meshPeers[pid].dataConn) meshPeers[pid].dataConn.close();
        if (typeof removeRemoteAudioUI === 'function') removeRemoteAudioUI(pid);
        delete meshPeers[pid];
    });

    if (typeof appendChat === 'function') {
        appendChat('system', '系统', "已离开房间网络");
    }

    resetToSoloHost();
    if (typeof updateMyIdentityUI === 'function') updateMyIdentityUI();
    if (typeof updateTopBarStatus === 'function') updateTopBarStatus();
}

// 配置数据通道
function setupDataConn(conn) {
    conn.on('open', () => {
        if (!meshPeers[conn.peer]) meshPeers[conn.peer] = {};
        meshPeers[conn.peer].dataConn = conn;

        // 主动发送握手包
        conn.send({ type: 'hello', name: window._myName || '未知' });

        if (typeof updateTopBarStatus === 'function') updateTopBarStatus();

        // 发送已知节点信息
        const known = Object.keys(meshPeers).filter(id => id !== conn.peer);
        if (known.length > 0) conn.send({ type: 'mesh-discover', peers: known });

        if (typeof broadcastVoiceState === 'function') broadcastVoiceState();
    });

    conn.on('data', data => {
        switch (data.type) {
            case 'hello': {
                const isFirstTime = !meshPeers[conn.peer].name;
                meshPeers[conn.peer].name = data.name;

                if (isFirstTime) {
                    if (typeof appendChat === 'function') {
                        appendChat('system', '系统', `[${data.name}] 接入了频道`);
                    }
                    if (meshEvents.onPeerJoin) meshEvents.onPeerJoin(conn.peer, data.name);

                    // 若已在语音房，自动建立语音连接
                    if (window._inVoiceRoom && typeof processedAudioStream !== 'undefined' && processedAudioStream) {
                        if (typeof callVoice === 'function') callVoice(conn.peer, data.name);
                    }
                }
                break;
            }
            case 'chat':
                if (typeof appendChat === 'function') appendChat('user', data.user, data.text);
                if (meshEvents.onChatMessage) meshEvents.onChatMessage(data.user, data.text);
                break;
            case 'system':
                if (typeof appendChat === 'function') appendChat('system', '系统', `[${data.user}] ${data.text}`);
                break;
            case 'mesh-discover':
                data.peers.forEach(pid => {
                    if (pid !== peer.id && !meshPeers[pid]) {
                        setupDataConn(peer.connect(pid));
                    }
                });
                break;
            case 'voice-leave':
                if (typeof removeRemoteAudioUI === 'function') removeRemoteAudioUI(data.userId);
                if (meshPeers[data.userId]) meshPeers[data.userId].voiceCall = null;
                break;
            case 'voice-state':
                if (typeof updateRemoteVoiceStatus === 'function') {
                    updateRemoteVoiceStatus(data.userId, data.micOn, data.speakerOn);
                }
                // 晚进房机制
                if (window._inVoiceRoom && meshPeers[data.userId] && !meshPeers[data.userId].voiceCall) {
                    if (typeof callVoice === 'function') callVoice(data.userId, meshPeers[data.userId].name);
                }
                break;
            case 'room-disband':
                alert("房主已解散了当前房间。");
                if (meshEvents.onRoomDisband) meshEvents.onRoomDisband();
                executeDisconnect();
                break;
        }
    });

    conn.on('close', () => {
        const name = meshPeers[conn.peer]?.name || '未知';
        if (typeof appendChat === 'function') {
            appendChat('system', '系统', `[${name}] 断开了连接`);
        }
        if (typeof removeRemoteAudioUI === 'function') removeRemoteAudioUI(conn.peer);
        if (meshEvents.onPeerLeave) meshEvents.onPeerLeave(conn.peer, name);
        delete meshPeers[conn.peer];
        if (typeof updateTopBarStatus === 'function') updateTopBarStatus();
        if (meshEvents.onMeshChange) meshEvents.onMeshChange();
    });
}

function broadcastData(data) {
    Object.values(meshPeers).forEach(p => {
        if (p.dataConn && p.dataConn.open) p.dataConn.send(data);
    });
}

function getMeshPeers() { return meshPeers; }
function getPeerName(pid) { return meshPeers[pid]?.name || '未知'; }
