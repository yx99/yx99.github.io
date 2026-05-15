// ==========================================
// 1. DOM 节点获取
// ==========================================
const ui = {
    myIdDisplay: document.getElementById('my-id-display'),
    myNameDisplay: document.getElementById('my-name-display'),
    myAvatarIcon: document.getElementById('my-avatar-icon'),
    chatBox: document.getElementById('chat-box'),
    videoContainer: document.getElementById('video-container'),
    remoteVideo: document.getElementById('remote-video'),
    shareBtn: document.getElementById('share-btn'),
    voiceUsersContainer: document.getElementById('voice-users-container'),
    connectArea: document.getElementById('connect-area'),
    roomStatusArea: document.getElementById('room-status-area'),
    meshNodeCount: document.getElementById('mesh-node-count'),
    topRoomIdDisplay: document.getElementById('top-room-id'),
    disconnectBtn: document.getElementById('disconnect-btn'),
    popup: document.getElementById('personal-vol-popup'),
    popupSlider: document.getElementById('personal-vol-slider')
};

// ==========================================
// 2. 全局核心状态
// ==========================================
let peer;
let myFullId = '';
let myName = localStorage.getItem('geek_username') || ('user_' + Math.floor(Math.random() * 1000));

// 房间状态 (Mesh 网络基础)
let isHost = true; // 默认自己是独立的房主
let currentRoomId = '';
let meshPeers = {}; // 存储当前房间内的所有其他节点连接

// 语音状态
let inVoiceRoom = false;
let rawAudioStream = null;      // 原始麦克风流
let processedAudioStream = null;// 经过增益处理后的音频流
let micGainNode = null;         // Web Audio API 增益节点
let isMicOn = true;
let isSpeakerOn = true;
let masterVolume = 1.0;
let userVolumes = {};           // 每个用户的独立音量 { peerId: volume }

// 投屏状态
let currentScreenStream = null;
let outgoingScreenCalls = [];
let incomingScreenCall = null;


// ==========================================
// 3. 系统初始化与 PeerJS 配置
// ==========================================
function initPeerSystem() {
    localStorage.setItem('geek_username', myName);
    updateMyIdentityUI();

    let turnPassword = localStorage.getItem('my_turn_password');
    if (!turnPassword) {
        turnPassword = prompt("【安全提示】\n请输入服务器密码：\n(密码仅保存在本地。若不输入点击取消，跨网可能无法投屏)");
        if (turnPassword) localStorage.setItem('my_turn_password', turnPassword);
    }

    const peerConfig = {
        host: '0.peerjs.com', port: 443, secure: true,
        config: { 'iceTransportPolicy': 'all', 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] }
    };

    // 注入中继(TURN)服务器保证跨网穿透成功率
    if (turnPassword) {
        peerConfig.config.iceServers.push(
            { urls: 'turn:standard.relay.metered.ca:80', username: '24a3487d75b2f7131db44b6a', credential: turnPassword },
            { urls: 'turn:standard.relay.metered.ca:443', username: '24a3487d75b2f7131db44b6a', credential: turnPassword }
        );
    }

    // 初始化全局单例 Peer
    peer = new Peer(peerConfig);
    bindPeerEvents(); 
}

function bindPeerEvents() {
    // 1. 信令连接成功
    peer.on('open', id => { 
        myFullId = id; 
        currentRoomId = id;
        updateMyIdentityUI();
        console.log("✅ 信令服务器已连接，ID:", id);
    });

    // 2. 被动收到 DataConnection (文字/状态网络接入)
    peer.on('connection', conn => setupDataConn(conn));

    // 3. 被动收到 MediaConnection (语音/投屏接入)
    peer.on('call', call => {
        const type = call.metadata?.type || 'screen';
        
        if (type === 'voice') {
            if (!inVoiceRoom) return call.close(); // 自己不在语音房则拒接
            
            const callerName = call.metadata.name || '未知';
            if (!meshPeers[call.peer]) meshPeers[call.peer] = { name: callerName };
            meshPeers[call.peer].voiceCall = call;
            
            call.answer(processedAudioStream); // 接听并发送自己的音频流
            call.on('stream', stream => setupRemoteAudioUI(call.peer, callerName, stream));
            call.on('close', () => removeRemoteAudioUI(call.peer));
        } else {
            // 处理屏幕共享接入
            incomingScreenCall = call;
            call.answer(); 
            call.on('stream', stream => {
                ui.videoContainer.style.display = 'flex';
                ui.remoteVideo.srcObject = stream;
                document.getElementById('hangup-btn').style.display = 'inline-block';
                ui.shareBtn.disabled = true; 
                ui.shareBtn.innerText = "观看中"; 
                ui.shareBtn.style.opacity = "0.5";
            });
            call.on('close', hangUpScreen); // 对端结束时清理
        }
    });

    peer.on('error', err => {
        console.error("❌ PeerJS 错误:", err);
        if (err.type === 'peer-unavailable') alert("找不到目标 ID，请检查输入是否正确。");
    });
}


// ==========================================
// 4. 用户基础与 UI 管理
// ==========================================
function updateMyIdentityUI() {
    ui.myNameDisplay.innerText = myName;
    ui.myAvatarIcon.innerText = myName.charAt(0).toUpperCase();
    if(myFullId) {
        ui.myIdDisplay.innerText = "ID: " + myFullId.substring(0, 6) + "...";
        ui.topRoomIdDisplay.innerText = "房间 ID: " + currentRoomId.substring(0, 6) + "...";
    }
}

function changeName() {
    const newName = prompt("请输入新的昵称：", myName);
    if (newName && newName.trim() !== '') {
        myName = newName;
        localStorage.setItem('geek_username', myName);
        updateMyIdentityUI();
        if(inVoiceRoom) document.getElementById('my-voice-name').innerText = myName;
        broadcastData({ type: 'system', text: `已改名为 ${myName}`, user: myName });
    }
}

function resetConfig() {
    if (confirm("确定要修改服务器密码吗？\n这将清除当前保存的配置并重新启动应用。")) {
        localStorage.removeItem('my_turn_password');
        window.location.reload();
    }
}

// 剪贴板复制工具
function copyMyId() { copyToClipboard(myFullId, ui.myIdDisplay); }
function copyRoomId() { copyToClipboard(currentRoomId, ui.topRoomIdDisplay); }
function copyToClipboard(text, el) {
    if (!text) return alert("暂无 ID！");
    navigator.clipboard.writeText(text).then(() => {
        const origin = el.innerText;
        el.innerText = "✅ 复制成功";
        el.style.color = "var(--success)";
        setTimeout(() => {
            el.innerText = origin;
            el.style.color = "";
        }, 2000);
    });
}

function updateTopBarStatus() {
    const count = Object.keys(meshPeers).length;
    if (count > 0) {
        ui.connectArea.style.display = 'none';
        ui.roomStatusArea.style.display = 'flex';
        ui.meshNodeCount.innerText = count + 1; // 加上自己
        
        // 动态更新断开按钮状态
        ui.disconnectBtn.innerText = isHost ? "解散房间" : "离开房间";
        ui.disconnectBtn.className = isHost ? "btn-danger" : "btn-outline";
    } else {
        ui.connectArea.style.display = 'flex';
        ui.roomStatusArea.style.display = 'none';
    }
}


// ==========================================
// 5. Mesh 网络逻辑 (房间与数据通信)
// ==========================================
// 主动加入别人的房间
function connectToMesh() {
    const targetId = document.getElementById('target-id').value.trim();
    if (!targetId || targetId === peer.id) return alert("无效的 ID");
    if (meshPeers[targetId]) return alert("已在网中");

    isHost = false; // 主动连接别人，降级为访客
    currentRoomId = targetId; 
    ui.topRoomIdDisplay.innerText = "房间 ID: " + currentRoomId.substring(0, 6) + "...";

    const conn = peer.connect(targetId);
    setupDataConn(conn);
    document.getElementById('target-id').value = ''; 
}

// 断开与解散
function disconnectMesh() {
    if (isHost) {
        if(!confirm("您是房主，确定要解散房间吗？所有人将被强制断开。")) return;
        broadcastData({ type: 'room-disband' }); // 广播毁灭指令
    } else {
        if(!confirm("确定要离开当前房间吗？")) return;
    }
    executeDisconnect();
}

function executeDisconnect() {
    if(inVoiceRoom) toggleVoiceRoom(); 
    if(currentScreenStream) stopSharing(); 
    
    Object.keys(meshPeers).forEach(pid => {
        if(meshPeers[pid].dataConn) meshPeers[pid].dataConn.close();
        removeRemoteAudioUI(pid);
        delete meshPeers[pid];
    });
    
    appendChat('system', '系统', "已离开房间网络");
    
    // 重置回独立房主状态
    isHost = true;
    currentRoomId = myFullId;
    updateMyIdentityUI();
    updateTopBarStatus();
}

// 配置节点间的数据通道
function setupDataConn(conn) {
    conn.on('open', () => {
        // 1. 初始化对方的数据结构
        if (!meshPeers[conn.peer]) meshPeers[conn.peer] = {};
        meshPeers[conn.peer].dataConn = conn;

        // 2. 【修复核心】连接一建立，立刻主动把自己的真实名字发给对方
        conn.send({ type: 'hello', name: myName });

        updateTopBarStatus();
        
        // 发送 Mesh 网络其他节点信息
        const known = Object.keys(meshPeers).filter(id => id !== conn.peer);
        if (known.length > 0) conn.send({ type: 'mesh-discover', peers: known });

        broadcastVoiceState();
    });

    conn.on('data', data => {
        switch(data.type) {
            case 'hello': // 收到对方的 hello 握手包，记录真实名字
                const isFirstTime = !meshPeers[conn.peer].name;
                meshPeers[conn.peer].name = data.name; 
                
                if (isFirstTime) {
                    appendChat('system', '系统', `[${data.name}] 接入了频道`);
                    if (inVoiceRoom && processedAudioStream) {
                        callVoice(conn.peer, data.name);
                    }
                }
                break;
            case 'chat': 
                appendChat('user', data.user, data.text); 
                break;
            case 'system': 
                appendChat('system', '系统', `[${data.user}] ${data.text}`); 
                break;
            case 'mesh-discover': // 自动连接网内的其他陌生节点
                data.peers.forEach(pid => {
                    if (pid !== peer.id && !meshPeers[pid]) {
                        setupDataConn(peer.connect(pid, { metadata: { name: myName } }));
                    }
                });
                break;
            case 'voice-leave':
                removeRemoteAudioUI(data.userId);
                if (meshPeers[data.userId]) meshPeers[data.userId].voiceCall = null;
                break;
            case 'voice-state':
                updateRemoteVoiceStatus(data.userId, data.micOn, data.speakerOn);
                // 晚进房机制：发现对方状态更新，且自己已在房内，则建立通话
                if (inVoiceRoom && !meshPeers[data.userId].voiceCall) {
                    callVoice(data.userId, meshPeers[data.userId].name);
                }
                break;
            case 'room-disband':
                alert("房主已解散了当前房间。");
                executeDisconnect();
                break;
        }
    });

    conn.on('close', () => {
        appendChat('system', '系统', `[${meshPeers[conn.peer]?.name}] 断开了连接`);
        removeRemoteAudioUI(conn.peer);
        delete meshPeers[conn.peer];
        updateTopBarStatus(); 
    });
}

function broadcastData(data) {
    Object.values(meshPeers).forEach(p => p.dataConn?.open && p.dataConn.send(data));
}


// ==========================================
// 6. 语音系统 (加入、设备控制、音量调节)
// ==========================================
async function toggleVoiceRoom() {
    if (inVoiceRoom) {
        // 退出语音逻辑
        inVoiceRoom = false;
        document.getElementById('voice-channel-btn').classList.remove('active');
        document.getElementById('voice-room-title').innerText = "大厅 (点击加入)";
        ui.voiceUsersContainer.classList.remove('open');
        
        if (rawAudioStream) { rawAudioStream.getTracks().forEach(t => t.stop()); rawAudioStream = null; }
        Object.keys(meshPeers).forEach(pid => {
            if (meshPeers[pid].voiceCall) { meshPeers[pid].voiceCall.close(); meshPeers[pid].voiceCall = null; }
        });
        
        broadcastData({ type: 'voice-leave', userId: peer.id });
        document.getElementById('audio-container').innerHTML = '';
        ui.voiceUsersContainer.innerHTML = '';
        userVolumes = {};
    } else {
        // 加入语音逻辑
        try {
            rawAudioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            
            // Web Audio API：拦截麦克风信号，加入控制增益(麦克风音量)的节点
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(rawAudioStream);
            micGainNode = audioCtx.createGain();
            micGainNode.gain.value = document.getElementById('mic-volume').value; 
            const destination = audioCtx.createMediaStreamDestination();
            
            source.connect(micGainNode);
            micGainNode.connect(destination);
            processedAudioStream = destination.stream; 
            processedAudioStream.getAudioTracks()[0].enabled = isMicOn;

            inVoiceRoom = true;
            document.getElementById('voice-channel-btn').classList.add('active');
            document.getElementById('voice-room-title').innerText = "语音连接中 / 退出";
            ui.voiceUsersContainer.classList.add('open');

            addSelfToVoiceUI();
            broadcastVoiceState(); 

            // 向现有成员拨号
            Object.keys(meshPeers).forEach(pid => callVoice(pid, meshPeers[pid].name));
        } catch(e) { 
            alert("加入失败：未获得麦克风权限"); 
        }
    }
}

function callVoice(targetId, targetName) {
    if (!processedAudioStream || !inVoiceRoom) return;
    const call = peer.call(targetId, processedAudioStream, { metadata: { type: 'voice', name: myName } });
    meshPeers[targetId].voiceCall = call;
    call.on('stream', stream => setupRemoteAudioUI(targetId, targetName, stream));
    call.on('close', () => removeRemoteAudioUI(targetId));
}

// -- 本机设备控制 --
const getMicIcon = (isOn) => isOn ? "🎤" : "<span style='color:var(--danger)'>🚫</span>";
const getSpeakerIcon = (isOn) => isOn ? "🔊" : "<span style='color:var(--danger)'>🔇</span>";

function broadcastVoiceState() {
    broadcastData({ type: 'voice-state', userId: peer.id, micOn: isMicOn, speakerOn: isSpeakerOn });
    const micIcon = document.getElementById('my-voice-mic');
    const speakerIcon = document.getElementById('my-voice-speaker');
    if(micIcon) micIcon.innerHTML = getMicIcon(isMicOn);
    if(speakerIcon) speakerIcon.innerHTML = getSpeakerIcon(isSpeakerOn);
}

function toggleMic() {
    isMicOn = !isMicOn;
    if (processedAudioStream) processedAudioStream.getAudioTracks()[0].enabled = isMicOn;
    document.getElementById('mic-btn').classList.toggle('muted', !isMicOn);
    broadcastVoiceState(); 
}

function changeMicGain(val) { if(micGainNode) micGainNode.gain.value = parseFloat(val); }

function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    document.getElementById('speaker-btn').classList.toggle('muted', !isSpeakerOn);
    document.querySelectorAll('#audio-container audio').forEach(a => a.muted = !isSpeakerOn);
    broadcastVoiceState();
}

// -- 远端音频渲染与个人音量 --
function changeMasterVolume(val) { masterVolume = parseFloat(val); applyAllVolumes(); }
function applyAllVolumes() {
    if(!isSpeakerOn) return; 
    document.querySelectorAll('#audio-container audio').forEach(audioEl => {
        const pid = audioEl.getAttribute('data-peer-id');
        const pVol = userVolumes[pid] !== undefined ? userVolumes[pid] : 1.0;
        audioEl.volume = masterVolume * pVol;
    });
}

function addSelfToVoiceUI() {
    const div = document.createElement('div');
    div.className = 'voice-user';
    div.innerHTML = `<div class="avatar">${myName.charAt(0)}</div>
                    <span id="my-voice-name" style="flex:1;">${myName}</span>
                    <span id="my-voice-mic" style="margin-left:4px;">${getMicIcon(isMicOn)}</span>
                    <span id="my-voice-speaker" style="margin-left:4px;">${getSpeakerIcon(isSpeakerOn)}</span>`;
    ui.voiceUsersContainer.appendChild(div);
}

function setupRemoteAudioUI(peerId, peerName, stream) {
    if (document.getElementById(`vu-${peerId}`)) return; 
    
    // 渲染隐式 Audio 标签
    const audio = document.createElement('audio');
    audio.id = `au-${peerId}`; 
    audio.setAttribute('data-peer-id', peerId);
    audio.autoplay = true; 
    audio.srcObject = stream; 
    audio.muted = !isSpeakerOn;
    document.getElementById('audio-container').appendChild(audio);
    
    userVolumes[peerId] = 1.0; 
    applyAllVolumes();

    // 渲染左侧栏 UI
    const div = document.createElement('div');
    div.className = 'voice-user'; div.id = `vu-${peerId}`; div.title = "点击调节音量";
    div.innerHTML = `<div class="avatar">${peerName.charAt(0)}</div>
                    <span style="flex:1;">${peerName}</span>
                    <span id="remote-mic-${peerId}" style="margin-left:4px;">🎤</span>
                    <span id="remote-speaker-${peerId}" style="margin-left:4px;">🔊</span>`;
    div.onclick = (e) => showPersonalVolumePopup(e, peerId, peerName);
    ui.voiceUsersContainer.appendChild(div);
}

function updateRemoteVoiceStatus(peerId, rmMicOn, rmSpeakerOn) {
    const micSpan = document.getElementById(`remote-mic-${peerId}`);
    const speakerSpan = document.getElementById(`remote-speaker-${peerId}`);
    if(micSpan) micSpan.innerHTML = getMicIcon(rmMicOn);
    if(speakerSpan) speakerSpan.innerHTML = getSpeakerIcon(rmSpeakerOn);
}

function removeRemoteAudioUI(peerId) {
    document.getElementById(`vu-${peerId}`)?.remove();
    document.getElementById(`au-${peerId}`)?.remove();
    delete userVolumes[peerId];
    if(ui.popup.getAttribute('data-target') === peerId) {
        ui.popup.style.display = 'none';
    }
}


// ==========================================
// 7. 投屏系统
// ==========================================
async function toggleShare() {
    if (currentScreenStream) return stopSharing();
    if (Object.keys(meshPeers).length === 0) return alert("网络中没有其他人！");

    const quality = document.getElementById('video-quality').value;
    let constraints = { cursor: "always" };

    switch (quality) {
        case '1080p60': constraints.width = { max: 1920 }; constraints.height = { max: 1080 }; constraints.frameRate = { max: 60 }; break;
        case '1080p': constraints.width = { max: 1920 }; constraints.height = { max: 1080 }; constraints.frameRate = { max: 30 }; break;
        case '720p': constraints.width = { max: 1280 }; constraints.height = { max: 720 }; constraints.frameRate = { max: 30 }; break;
        case '480p': constraints.width = { max: 854 }; constraints.height = { max: 480 }; constraints.frameRate = { max: 15 }; break;
        default: constraints.width = { max: 1920, ideal: 1920 }; constraints.height = { max: 1080, ideal: 1080 }; constraints.frameRate = { max: 30 }; break;
    }

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: constraints, 
            audio: { systemAudio: "include", echoCancellation: true }
        });
        currentScreenStream = stream;
        
        ui.shareBtn.innerText = "停止投屏"; 
        ui.shareBtn.classList.replace("btn-primary", "btn-danger");

        // 向所有节点广播画面
        outgoingScreenCalls = [];
        Object.keys(meshPeers).forEach(pid => {
            outgoingScreenCalls.push(peer.call(pid, stream, { metadata: { type: 'screen' } }));
        });
        
        // 监听系统自带的“停止共享”按钮点击事件
        stream.getVideoTracks()[0].onended = stopSharing;
    } catch (err) { 
        if(err.name !== 'NotAllowedError') alert("屏幕捕获失败"); 
    }
}

function stopSharing() {
    if (currentScreenStream) { 
        currentScreenStream.getTracks().forEach(t => t.stop()); 
        currentScreenStream = null; 
    }
    outgoingScreenCalls.forEach(c => c.close()); 
    outgoingScreenCalls = [];
    ui.shareBtn.innerText = "发起投屏"; 
    ui.shareBtn.classList.replace("btn-danger", "btn-primary");
    ui.shareBtn.disabled = false;
}

function hangUpScreen() {
    if (incomingScreenCall) { incomingScreenCall.close(); incomingScreenCall = null; }
    ui.videoContainer.style.display = 'none'; 
    ui.remoteVideo.srcObject = null;
    document.getElementById('hangup-btn').style.display = 'none';
    ui.shareBtn.disabled = false; 
    ui.shareBtn.innerText = "发起投屏"; 
    ui.shareBtn.style.opacity = "1";
}


// ==========================================
// 8. 聊天与 UI 交互辅助
// ==========================================
function appendChat(type, user, text) {
    const msgBlock = document.createElement('div');
    msgBlock.className = 'msg-block';
    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    if (type === 'system') {
        msgBlock.innerHTML = `<div class="msg-content" style="color:var(--text-muted); font-size:0.9rem;">➡️ <span style="font-weight:bold;">${user}</span>: ${text}</div>`;
    } else {
        msgBlock.innerHTML = `
            <div class="msg-avatar">${user.charAt(0).toUpperCase()}</div>
            <div class="msg-content">
                <div class="msg-header"><span class="msg-author">${user}</span><span class="msg-time">${timeStr}</span></div>
                <div class="msg-text">${text}</div>
            </div>`;
    }
    ui.chatBox.appendChild(msgBlock);
    ui.chatBox.scrollTop = ui.chatBox.scrollHeight;
}

function handleChatEnter(e) { if (e.key === 'Enter') sendChatMessage(); }
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    appendChat('user', myName, text);
    broadcastData({ type: 'chat', user: myName, text });
    input.value = '';
}

// 独立音量弹窗控制
function showPersonalVolumePopup(event, peerId, peerName) {
    event.stopPropagation();
    document.getElementById('personal-vol-name').innerText = `调节 ${peerName} 的音量`;
    ui.popupSlider.value = userVolumes[peerId] !== undefined ? userVolumes[peerId] : 1.0;
    ui.popupSlider.oninput = (e) => { 
        userVolumes[peerId] = parseFloat(e.target.value); 
        applyAllVolumes(); 
    };
    ui.popup.style.left = (event.pageX + 15) + 'px'; 
    ui.popup.style.top = (event.pageY - 10) + 'px';
    ui.popup.style.display = 'flex'; 
    ui.popup.setAttribute('data-target', peerId);
}
document.addEventListener('click', (e) => { 
    if (!ui.popup.contains(e.target)) ui.popup.style.display = 'none'; 
});


// ==========================================
// 启动入口
// ==========================================
initPeerSystem();