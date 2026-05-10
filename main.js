// ==========================================
// 安全配置：Metered TURN 服务器密码检查
// ==========================================
let turnPassword = localStorage.getItem('my_turn_password');

// ==========================================
// 全局状态与 DOM 引用
// ==========================================
const myIdDisplay = document.getElementById('my-id-display');
const myNameDisplay = document.getElementById('my-name-display');
const myAvatarIcon = document.getElementById('my-avatar-icon');
const chatBox = document.getElementById('chat-box');
const videoContainer = document.getElementById('video-container');
const remoteVideo = document.getElementById('remote-video');
const shareBtn = document.getElementById('share-btn');
const voiceUsersContainer = document.getElementById('voice-users-container');

const connectArea = document.getElementById('connect-area');
const roomStatusArea = document.getElementById('room-status-area');
const meshNodeCount = document.getElementById('mesh-node-count');
const topRoomIdDisplay = document.getElementById('top-room-id');
const disconnectBtn = document.getElementById('disconnect-btn');

let peer;
let myFullId = '';
let myName = localStorage.getItem('geek_username') || ('极客_' + Math.floor(Math.random() * 1000));
localStorage.setItem('geek_username', myName);

// 房间主客状态机
let isHost = true; // 默认自己是房主
let currentRoomId = '';
let meshPeers = {}; 

// 语音状态
let inVoiceRoom = false;
let rawAudioStream = null;      
let processedAudioStream = null;
let micGainNode = null;         
let isMicOn = true;
let isSpeakerOn = true;
let masterVolume = 1.0;
let userVolumes = {}; 

// 投屏状态
let currentScreenStream = null;
let outgoingScreenCalls = [];
let incomingScreenCall = null;

// ==========================================
// 1. 初始化与 ID 管理
// ==========================================
if (!myName) {
    myName = 'user_' + Math.floor(Math.random() * 1000);
    localStorage.setItem('geek_username', myName);
}
updateMyIdentityUI();

function updateMyIdentityUI() {
    myNameDisplay.innerText = myName;
    myAvatarIcon.innerText = myName.charAt(0).toUpperCase();
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

// 复制左下角本机 ID
function copyMyId() {
    if (!myFullId) return alert("信令还未连接成功！");
    navigator.clipboard.writeText(myFullId).then(() => {
        myIdDisplay.innerText = "✅ 复制成功";
        myIdDisplay.style.color = "var(--success)";
        setTimeout(() => {
            myIdDisplay.innerText = "ID: " + myFullId.substring(0, 6) + "...";
            myIdDisplay.style.color = "";
        }, 2000);
    });
}

// 🌟 复制顶部房间 ID
function copyRoomId() {
    if (!currentRoomId) return;
    navigator.clipboard.writeText(currentRoomId).then(() => {
        const originalText = topRoomIdDisplay.innerText;
        topRoomIdDisplay.innerText = "✅ 复制成功";
        setTimeout(() => topRoomIdDisplay.innerText = originalText, 2000);
    });
}

const peerConfig = {
    host: '0.peerjs.com', port: 443, secure: true,
    config: { 'iceTransportPolicy': 'all', 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] }
};

// 如果有密码，注入 TURN 服务器配置
if (turnPassword) {
    peerConfig.config.iceServers.push(
        { urls: 'turn:standard.relay.metered.ca:80', username: '24a3487d75b2f7131db44b6a', credential: turnPassword },
        { urls: 'turn:standard.relay.metered.ca:443', username: '24a3487d75b2f7131db44b6a', credential: turnPassword }
    );
}

peer = new Peer(peerConfig);
peer.on('open', id => { 
    myFullId = id; 
    currentRoomId = id;
    updateIdentityUI();
});

function updateIdentityUI() {
    myIdDisplay.innerText = "ID: " + myFullId.substring(0, 6) + "...";
    topRoomIdDisplay.innerText = "房间 ID: " + currentRoomId.substring(0, 6) + "...";
    myNameDisplay.innerText = myName;
    myAvatarIcon.innerText = myName.charAt(0).toUpperCase();
}

// ==========================================
// 2. 顶栏动态 UI 更新逻辑
// ==========================================
function updateTopBarStatus() {
    const count = Object.keys(meshPeers).length;
    if (count > 0) {
        connectArea.style.display = 'none';
        roomStatusArea.style.display = 'flex';
        meshNodeCount.innerText = count + 1; // 包含自己
        
        // 🌟 动态更新按钮状态
        if (isHost) {
            disconnectBtn.innerText = "🛑 解散房间";
            disconnectBtn.className = "btn-danger";
        } else {
            disconnectBtn.innerText = "离开房间";
            disconnectBtn.className = "btn-outline";
        }
    } else {
        connectArea.style.display = 'flex';
        roomStatusArea.style.display = 'none';
    }
}

// ==========================================
// 3. 数据与媒体拦截
// ==========================================
peer.on('connection', conn => setupDataConn(conn));

peer.on('call', call => {
    const type = call.metadata?.type || 'screen';
    if (type === 'voice') {
        if (!inVoiceRoom) return call.close(); 
        const callerName = call.metadata.name || '未知';
        if (!meshPeers[call.peer]) meshPeers[call.peer] = { name: callerName };
        meshPeers[call.peer].voiceCall = call;
        
        call.answer(processedAudioStream);
        call.on('stream', stream => setupRemoteAudioUI(call.peer, callerName, stream));
        call.on('close', () => removeRemoteAudioUI(call.peer));
    } else {
        incomingScreenCall = call;
        call.answer(); 
        call.on('stream', stream => {
            videoContainer.style.display = 'flex';
            remoteVideo.srcObject = stream;
            document.getElementById('hangup-btn').style.display = 'inline-block';
            shareBtn.disabled = true; shareBtn.innerText = "观看中"; shareBtn.style.opacity = "0.5";
        });
        call.on('close', () => {
            videoContainer.style.display = 'none';
            remoteVideo.srcObject = null;
            document.getElementById('hangup-btn').style.display = 'none';
            shareBtn.disabled = false; shareBtn.innerText = "发起投屏"; shareBtn.style.opacity = "1";
        });
    }
});

// ==========================================
// 4. 主客网络逻辑 (Mesh)
// ==========================================
function connectToMesh() {
    const targetId = document.getElementById('target-id').value.trim();
    if (!targetId || targetId === peer.id) return alert("无效的 ID");
    if (meshPeers[targetId]) return alert("已在网中");

    // 🌟 只要我主动去连接别人，我就是客人
    isHost = false;
    currentRoomId = targetId; 
    topRoomIdDisplay.innerText = "房间 ID: " + currentRoomId.substring(0, 6) + "...";

    const conn = peer.connect(targetId, { metadata: { name: myName } });
    setupDataConn(conn);
    document.getElementById('target-id').value = ''; 
}

// 🌟 新增：区分解散与离开的断开逻辑
function disconnectMesh() {
    if (isHost) {
        if(!confirm("您是房主，确定要解散房间吗？所有人将被强制断开。")) return;
        broadcastData({ type: 'room-disband' }); // 广播毁灭指令
    } else {
        if(!confirm("确定要离开当前房间吗？")) return;
    }
    executeDisconnect();
}

// 物理断开执行器
function executeDisconnect() {
    if(inVoiceRoom) toggleVoiceRoom(); 
    if(currentScreenStream) stopSharing(); 
    
    Object.keys(meshPeers).forEach(pid => {
        if(meshPeers[pid].dataConn) meshPeers[pid].dataConn.close();
        removeRemoteAudioUI(pid);
        delete meshPeers[pid];
    });
    
    appendChat('system', '系统', "已离开房间网络");
    
    // 断开后，自己重新成为独立房主
    isHost = true;
    currentRoomId = myFullId;
    topRoomIdDisplay.innerText = "房间 ID: " + currentRoomId.substring(0, 6) + "...";
    updateTopBarStatus();
}

function setupDataConn(conn) {
    conn.on('open', () => {
        const pName = conn.metadata?.name || '用户';
        if (!meshPeers[conn.peer]) meshPeers[conn.peer] = {};
        meshPeers[conn.peer].dataConn = conn;
        meshPeers[conn.peer].name = pName;

        appendChat('system', '系统', `[${pName}] 接入了频道`);
        updateTopBarStatus(); 
        
        const known = Object.keys(meshPeers).filter(id => id !== conn.peer);
        if (known.length > 0) conn.send({ type: 'mesh-discover', peers: known });

        broadcastVoiceState(); 
        if (inVoiceRoom && processedAudioStream) callVoice(conn.peer, pName);
    });

    conn.on('data', data => {
        if (data.type === 'chat') appendChat('user', data.user, data.text);
        else if (data.type === 'system') appendChat('system', '系统', `[${data.user}] ${data.text}`);
        else if (data.type === 'mesh-discover') {
            data.peers.forEach(pid => {
                if (pid !== peer.id && !meshPeers[pid]) setupDataConn(peer.connect(pid, { metadata: { name: myName } }));
            });
        }
        else if (data.type === 'voice-leave') {
            removeRemoteAudioUI(data.userId);
            if (meshPeers[data.userId]) meshPeers[data.userId].voiceCall = null;
        }
        else if (data.type === 'voice-state') {
            updateRemoteVoiceStatus(data.userId, data.micOn, data.speakerOn);
        }
        // 🌟 收到房主解散通知
        else if (data.type === 'room-disband') {
            alert("房主已解散了当前房间。");
            executeDisconnect();
        }
    });

    conn.on('close', () => {
        appendChat('system', '系统', `[${meshPeers[conn.peer]?.name}] 断开了连接`);
        removeRemoteAudioUI(conn.peer);
        delete meshPeers[conn.peer];
        updateTopBarStatus(); 
    });
}

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
    chatBox.appendChild(msgBlock);
    chatBox.scrollTop = chatBox.scrollHeight;
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
function broadcastData(data) {
    Object.values(meshPeers).forEach(p => p.dataConn?.open && p.dataConn.send(data));
}

// ==========================================
// 5. 语音与状态同步核心
// ==========================================
async function toggleVoiceRoom() {
    if (inVoiceRoom) {
        inVoiceRoom = false;
        document.getElementById('voice-channel-btn').classList.remove('active');
        document.getElementById('voice-room-title').innerText = "大厅 (点击加入)";
        voiceUsersContainer.classList.remove('open');
        
        if (rawAudioStream) { rawAudioStream.getTracks().forEach(t => t.stop()); rawAudioStream = null; }
        Object.keys(meshPeers).forEach(pid => {
            if (meshPeers[pid].voiceCall) { meshPeers[pid].voiceCall.close(); meshPeers[pid].voiceCall = null; }
        });
        broadcastData({ type: 'voice-leave', userId: peer.id });
        
        document.getElementById('audio-container').innerHTML = '';
        voiceUsersContainer.innerHTML = '';
        userVolumes = {};
    } else {
        try {
            rawAudioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            
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
            voiceUsersContainer.classList.add('open');

            addSelfToVoiceUI();
            broadcastVoiceState(); 
            Object.keys(meshPeers).forEach(pid => callVoice(pid, meshPeers[pid].name));
        } catch(e) { alert("加入失败：未获得麦克风权限"); }
    }
}

function callVoice(targetId, targetName) {
    if (!processedAudioStream || !inVoiceRoom) return;
    const call = peer.call(targetId, processedAudioStream, { metadata: { type: 'voice', name: myName } });
    meshPeers[targetId].voiceCall = call;
    call.on('stream', stream => setupRemoteAudioUI(targetId, targetName, stream));
    call.on('close', () => removeRemoteAudioUI(targetId));
}

// 🌟 图标体系优化：麦克风用🎤/🚫，扬声器用🔊/🔇
function getMicIcon(isOn) { return isOn ? "🎤" : "<span style='color:var(--danger)'>🚫</span>"; }
function getSpeakerIcon(isOn) { return isOn ? "🔊" : "<span style='color:var(--danger)'>🔇</span>"; }

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

function changeMicGain(val) {
    if(micGainNode) micGainNode.gain.value = parseFloat(val); 
}

function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    document.getElementById('speaker-btn').classList.toggle('muted', !isSpeakerOn);
    document.querySelectorAll('#audio-container audio').forEach(a => a.muted = !isSpeakerOn);
    broadcastVoiceState();
}

function changeMasterVolume(val) { masterVolume = parseFloat(val); applyAllVolumes(); }

function applyAllVolumes() {
    if(!isSpeakerOn) return; 
    document.querySelectorAll('#audio-container audio').forEach(audioEl => {
        const pid = audioEl.getAttribute('data-peer-id');
        const pVol = userVolumes[pid] !== undefined ? userVolumes[pid] : 1.0;
        audioEl.volume = masterVolume * pVol;
    });
}

// ==========================================
// 6. UI 生成与更新
// ==========================================
function addSelfToVoiceUI() {
    const ui = document.createElement('div');
    ui.className = 'voice-user';
    ui.innerHTML = `<div class="avatar">${myName.charAt(0)}</div>
                    <span id="my-voice-name" style="flex:1;">${myName}</span>
                    <span id="my-voice-mic" style="margin-left:4px;">${getMicIcon(isMicOn)}</span>
                    <span id="my-voice-speaker" style="margin-left:4px;">${getSpeakerIcon(isSpeakerOn)}</span>`;
    voiceUsersContainer.appendChild(ui);
}

function setupRemoteAudioUI(peerId, peerName, stream) {
    if (document.getElementById(`vu-${peerId}`)) return; 
    const audio = document.createElement('audio');
    audio.id = `au-${peerId}`; audio.setAttribute('data-peer-id', peerId);
    audio.autoplay = true; audio.srcObject = stream; audio.muted = !isSpeakerOn;
    document.getElementById('audio-container').appendChild(audio);
    
    userVolumes[peerId] = 1.0; applyAllVolumes();

    const ui = document.createElement('div');
    ui.className = 'voice-user'; ui.id = `vu-${peerId}`; ui.title = "点击调节音量";
    // 默认远端用户的图标状态先显示为正常，等收到心跳包/握手包后再变
    ui.innerHTML = `<div class="avatar">${peerName.charAt(0)}</div>
                    <span style="flex:1;">${peerName}</span>
                    <span id="remote-mic-${peerId}" style="margin-left:4px;">🎤</span>
                    <span id="remote-speaker-${peerId}" style="margin-left:4px;">🔊</span>`;
    ui.onclick = (e) => showPersonalVolumePopup(e, peerId, peerName);
    voiceUsersContainer.appendChild(ui);
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
    if(document.getElementById('personal-vol-popup').getAttribute('data-target') === peerId) {
        document.getElementById('personal-vol-popup').style.display = 'none';
    }
}

// ==========================================
// 7. 投屏控制与弹窗辅助
// ==========================================
async function toggleShare() {
    if (currentScreenStream) return stopSharing();
    if (Object.keys(meshPeers).length === 0) return alert("网络中没有其他人！");

    const quality = document.getElementById('video-quality').value;
    
    // 默认基础约束
    let constraints = { cursor: "always" };

    // 自动画质限制逻辑：封顶 1080p/30fps，允许浏览器动态下调
    switch (quality) {
        case '1080p':
            constraints.width = { max: 1920 };
            constraints.height = { max: 1080 };
            constraints.frameRate = { max: 30 };
            break;
        case '720p':
            constraints.width = { max: 1280 };
            constraints.height = { max: 720 };
            constraints.frameRate = { max: 30 };
            break;
        case '480p':
            constraints.width = { max: 854 };
            constraints.height = { max: 480 };
            constraints.frameRate = { max: 15 }; 
            break;
        case 'auto':
        default:
            constraints.width = { max: 1920, ideal: 1920 };
            constraints.height = { max: 1080, ideal: 1080 };
            constraints.frameRate = { max: 30 }; 
            break;
    }

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: constraints, 
            audio: { systemAudio: "include", echoCancellation: true }
        });
        currentScreenStream = stream;
        shareBtn.innerText = "停止投屏"; shareBtn.classList.add("btn-danger"); shareBtn.classList.remove("btn-primary");

        outgoingScreenCalls = [];
        Object.keys(meshPeers).forEach(pid => {
            outgoingScreenCalls.push(peer.call(pid, stream, { metadata: { type: 'screen' } }));
        });
        stream.getVideoTracks()[0].onended = stopSharing;
    } catch (err) { if(err.name !== 'NotAllowedError') alert("屏幕捕获失败"); }
}

function stopSharing() {
    if (currentScreenStream) { currentScreenStream.getTracks().forEach(t => t.stop()); currentScreenStream = null; }
    outgoingScreenCalls.forEach(c => c.close()); outgoingScreenCalls = [];
    shareBtn.innerText = "发起投屏"; shareBtn.classList.remove("btn-danger"); shareBtn.classList.add("btn-primary");
    shareBtn.disabled = false;
}

function hangUpScreen() {
    if (incomingScreenCall) { incomingScreenCall.close(); incomingScreenCall = null; }
    videoContainer.style.display = 'none'; remoteVideo.srcObject = null;
    document.getElementById('hangup-btn').style.display = 'none';
    shareBtn.disabled = false; shareBtn.innerText = "发起投屏"; shareBtn.style.opacity = "1";
}

const popup = document.getElementById('personal-vol-popup');
const popupSlider = document.getElementById('personal-vol-slider');
function showPersonalVolumePopup(event, peerId, peerName) {
    event.stopPropagation();
    document.getElementById('personal-vol-name').innerText = `调节 ${peerName} 的音量`;
    popupSlider.value = userVolumes[peerId] !== undefined ? userVolumes[peerId] : 1.0;
    popupSlider.oninput = (e) => { userVolumes[peerId] = parseFloat(e.target.value); applyAllVolumes(); };
    popup.style.left = (event.pageX + 15) + 'px'; popup.style.top = (event.pageY - 10) + 'px';
    popup.style.display = 'flex'; popup.setAttribute('data-target', peerId);
}
document.addEventListener('click', (e) => { if (!popup.contains(e.target)) popup.style.display = 'none'; });

// ==========================================
// 重置与修改配置逻辑
// ==========================================
function resetConfig() {
    const action = confirm("确定要修改服务器密码吗？\n这将清除当前保存的配置并重新启动应用。");
    if (action) {
        // 清除本地存储的密码
        localStorage.removeItem('my_turn_password');
        // 也可以选择是否清除昵称
        // localStorage.removeItem('geek_username'); 
        
        // 强制刷新页面重新触发初始化弹窗
        window.location.reload();
    }
}

// ==========================================
// 优化初始化流程 (确保弹窗后立即生效)
// ==========================================
// 我们把 Peer 初始化包裹在一个逻辑里
function initPeerSystem() {
    let turnPassword = localStorage.getItem('my_turn_password');

    if (!turnPassword) {
        turnPassword = prompt("【安全提示】\n请输入服务器密码：\n(密码仅保存在本地。若不输入点击取消，将仅尝试 P2P 直连，跨网可能无法投屏)");
        if (turnPassword) {
            localStorage.setItem('my_turn_password', turnPassword);
        }
    }

    const peerConfig = {
        host: '0.peerjs.com', port: 443, secure: true,
        config: { 
            'iceTransportPolicy': 'all', 
            'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] 
        }
    };

    if (turnPassword) {
        peerConfig.config.iceServers.push(
            { urls: 'turn:standard.relay.metered.ca:80', username: '24a3487d75b2f7131db44b6a', credential: turnPassword },
            { urls: 'turn:standard.relay.metered.ca:443', username: '24a3487d75b2f7131db44b6a', credential: turnPassword }
        );
    }

    peer = new Peer(peerConfig);
    
    // 绑定所有的 peer 事件监听器 (open, connection, call 等)
    bindPeerEvents(); 
}

// 页面加载完成后启动
initPeerSystem();