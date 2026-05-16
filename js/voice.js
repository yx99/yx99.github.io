// ==========================================
// voice.js — 语音处理管线 + 通话管理
// ==========================================

// 全局状态
let inVoiceRoom = false;
window._inVoiceRoom = false;

let rawAudioStream = null;
let processedAudioStream = null;
let audioCtx = null;
let micGainNode = null;
let noiseGateNode = null;
let compressorNode = null;
let analyserNode = null;
let isMicOn = true;
let isSpeakerOn = true;
let masterVolume = 1.0;
let userVolumes = {};

// 语音活动检测状态
let speakingStates = {};  // { peerId: { speaking: bool, lastActivity: timestamp } }
let localSpeaking = false;
let speakingCheckInterval = null;

// 远端音频分析器
let remoteAnalysers = {}; // { peerId: { analyser, dataArray } }

// ==========================================
// 音频处理管线构建
// ==========================================
function buildAudioPipeline(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);

    // 1. 噪声门 (自定义 ScriptProcessor 或用 Gain 模拟)
    noiseGateNode = audioCtx.createGain();
    noiseGateNode.gain.value = 1.0;
    source.connect(noiseGateNode);

    // 2. 麦克风增益
    micGainNode = audioCtx.createGain();
    micGainNode.gain.value = parseFloat(document.getElementById('mic-volume')?.value || CONFIG.VOICE.defaultMicGain);
    noiseGateNode.connect(micGainNode);

    // 3. 动态压缩器 (自动增益控制)
    compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.setValueAtTime(CONFIG.VOICE.compressorThreshold, audioCtx.currentTime);
    compressorNode.ratio.setValueAtTime(CONFIG.VOICE.compressorRatio, audioCtx.currentTime);
    compressorNode.knee.setValueAtTime(CONFIG.VOICE.compressorKnee, audioCtx.currentTime);
    compressorNode.attack.setValueAtTime(CONFIG.VOICE.attackMs / 1000, audioCtx.currentTime);
    compressorNode.release.setValueAtTime(CONFIG.VOICE.releaseMs / 1000, audioCtx.currentTime);
    micGainNode.connect(compressorNode);

    // 4. 分析器 (音量检测 — 驱动说话指示灯)
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = CONFIG.VOICE.analyserFftSize;
    compressorNode.connect(analyserNode);

    // 5. 输出
    const destination = audioCtx.createMediaStreamDestination();
    analyserNode.connect(destination);

    return destination.stream;
}

// ==========================================
// 语音活动检测
// ==========================================
function startSpeakingDetection() {
    if (speakingCheckInterval) return;
    speakingCheckInterval = setInterval(() => {
        checkLocalSpeaking();
        checkRemoteSpeaking();
    }, 100);
}

function stopSpeakingDetection() {
    if (speakingCheckInterval) {
        clearInterval(speakingCheckInterval);
        speakingCheckInterval = null;
    }
}

function checkLocalSpeaking() {
    if (!analyserNode) return;
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const nowSpeaking = rms > CONFIG.VOICE.speakingThreshold && isMicOn;

    if (nowSpeaking !== localSpeaking) {
        localSpeaking = nowSpeaking;
        if (typeof updateLocalSpeakingUI === 'function') {
            updateLocalSpeakingUI(localSpeaking);
        }
    }
}

function checkRemoteSpeaking() {
    Object.keys(remoteAnalysers).forEach(pid => {
        const ra = remoteAnalysers[pid];
        if (!ra) return;
        ra.analyser.getByteTimeDomainData(ra.dataArray);

        let sum = 0;
        for (let i = 0; i < ra.dataArray.length; i++) {
            const val = (ra.dataArray[i] - 128) / 128;
            sum += val * val;
        }
        const rms = Math.sqrt(sum / ra.dataArray.length);
        const nowSpeaking = rms > CONFIG.VOICE.speakingThreshold;

        if (!speakingStates[pid]) speakingStates[pid] = { speaking: false, lastActivity: 0 };
        if (nowSpeaking !== speakingStates[pid].speaking) {
            speakingStates[pid].speaking = nowSpeaking;
            speakingStates[pid].lastActivity = nowSpeaking ? Date.now() : speakingStates[pid].lastActivity;
            if (typeof updateRemoteSpeakingUI === 'function') {
                updateRemoteSpeakingUI(pid, nowSpeaking);
            }
        }
    });
}

function getSpeakingState(peerId) {
    if (peerId === getMyId()) return localSpeaking;
    return speakingStates[peerId]?.speaking || false;
}

// ==========================================
// 加入/退出语音房
// ==========================================
async function toggleVoiceRoom() {
    debugLog('voice', 'toggleVoiceRoom 触发, 当前状态 inVoiceRoom=', inVoiceRoom, 'meshPeers数=', Object.keys(meshPeers).length);
    if (inVoiceRoom) {
        // 退出
        debugLog('voice', '退出语音房');
        inVoiceRoom = false;
        window._inVoiceRoom = false;
        stopSpeakingDetection();

        const vcBtn = document.getElementById('voice-channel-btn');
        if (vcBtn) vcBtn.classList.remove('active');
        const vcTitle = document.getElementById('voice-room-title');
        if (vcTitle) vcTitle.innerText = "大厅 (点击加入)";

        const vuContainer = document.getElementById('voice-users-container');
        if (vuContainer) vuContainer.classList.remove('open');

        if (rawAudioStream) { rawAudioStream.getTracks().forEach(t => t.stop()); rawAudioStream = null; }
        if (audioCtx) { audioCtx.close(); audioCtx = null; }

        Object.keys(meshPeers).forEach(pid => {
            if (meshPeers[pid].voiceCall) { meshPeers[pid].voiceCall.close(); meshPeers[pid].voiceCall = null; }
        });

        broadcastData({ type: 'voice-leave', userId: peer.id });
        document.getElementById('audio-container').innerHTML = '';
        const vu = document.getElementById('voice-users-container');
        if (vu) vu.innerHTML = '';
        userVolumes = {};
        remoteAnalysers = {};
        speakingStates = {};
    } else {
        // 加入
        debugLog('voice', '开始加入语音房...');
        try {
            rawAudioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: { ideal: true },
                    noiseSuppression: { ideal: true },
                    autoGainControl: { ideal: true },
                    channelCount: { ideal: 1 }
                }
            });
            debugLog('voice', '麦克风已获取, 音轨数=', rawAudioStream.getAudioTracks().length);

            processedAudioStream = buildAudioPipeline(rawAudioStream);
            processedAudioStream.getAudioTracks()[0].enabled = isMicOn;
            debugLog('voice', '音频管线已构建');

            inVoiceRoom = true;
            window._inVoiceRoom = true;
            startSpeakingDetection();

            const vcBtn = document.getElementById('voice-channel-btn');
            if (vcBtn) vcBtn.classList.add('active');
            const vcTitle = document.getElementById('voice-room-title');
            if (vcTitle) vcTitle.innerText = "语音连接中 / 退出";

            const vuContainer = document.getElementById('voice-users-container');
            if (vuContainer) vuContainer.classList.add('open');

            if (typeof addSelfToVoiceUI === 'function') addSelfToVoiceUI();
            if (typeof broadcastVoiceState === 'function') broadcastVoiceState();

            // 向已有成员拨号
            const peerIds = Object.keys(meshPeers);
            debugLog('voice', '准备向', peerIds.length, '个对端发起语音呼叫:', peerIds);
            peerIds.forEach(pid => callVoice(pid, meshPeers[pid].name));
            debugLog('voice', '语音房加入完成');
        } catch (e) {
            debugLog('voice', '加入语音房失败:', e.message);
            alert("加入失败：未获得麦克风权限");
            console.error(e);
        }
    }
}

function callVoice(targetId, targetName) {
    if (!processedAudioStream || !inVoiceRoom) {
        debugLog('voice', 'callVoice 跳过: stream=', !!processedAudioStream, 'inRoom=', inVoiceRoom);
        return;
    }
    // 防止重复呼叫同一节点
    if (meshPeers[targetId] && meshPeers[targetId].voiceCall && meshPeers[targetId].voiceCall.open) {
        debugLog('voice', 'callVoice 跳过: 与', targetName || targetId, '已有活跃通话');
        return;
    }
    debugLog('voice', 'callVoice 发起→', targetName || targetId);
    const call = peer.call(targetId, processedAudioStream, {
        metadata: { type: 'voice', name: window._myName || '未知' }
    });
    if (!meshPeers[targetId]) meshPeers[targetId] = {};
    meshPeers[targetId].voiceCall = call;
    call.on('stream', stream => {
        debugLog('voice', 'callVoice 收到流←', targetName || targetId);
        setupRemoteAudioUI(targetId, targetName, stream);
    });
    call.on('close', () => {
        debugLog('voice', 'callVoice 通话关闭:', targetName || targetId);
        removeRemoteAudioUI(targetId);
        if (meshPeers[targetId]) meshPeers[targetId].voiceCall = null;
    });
    call.on('error', err => {
        debugLog('voice', 'callVoice 通话错误:', targetName || targetId, err);
        removeRemoteAudioUI(targetId);
        if (meshPeers[targetId]) meshPeers[targetId].voiceCall = null;
    });
}

// ==========================================
// 设备控制
// ==========================================
function getMicIcon(isOn)    { return isOn ? "🎤" : "<span style='color:var(--danger)'>🚫</span>"; }
function getSpeakerIcon(isOn) { return isOn ? "🔊" : "<span style='color:var(--danger)'>🔇</span>"; }

function broadcastVoiceState() {
    broadcastData({ type: 'voice-state', userId: peer.id, micOn: isMicOn, speakerOn: isSpeakerOn });
    const micIcon = document.getElementById('my-voice-mic');
    const speakerIcon = document.getElementById('my-voice-speaker');
    if (micIcon) micIcon.innerHTML = getMicIcon(isMicOn);
    if (speakerIcon) speakerIcon.innerHTML = getSpeakerIcon(isSpeakerOn);
}

function toggleMic() {
    isMicOn = !isMicOn;
    if (processedAudioStream) processedAudioStream.getAudioTracks()[0].enabled = isMicOn;
    const btn = document.getElementById('mic-btn');
    if (btn) btn.classList.toggle('muted', !isMicOn);
    broadcastVoiceState();
}

function changeMicGain(val) {
    if (micGainNode) micGainNode.gain.value = parseFloat(val);
}

function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    const btn = document.getElementById('speaker-btn');
    if (btn) btn.classList.toggle('muted', !isSpeakerOn);
    document.querySelectorAll('#audio-container audio').forEach(a => a.muted = !isSpeakerOn);
    broadcastVoiceState();
}

function changeMasterVolume(val) {
    masterVolume = parseFloat(val);
    applyAllVolumes();
}

function applyAllVolumes() {
    if (!isSpeakerOn) return;
    document.querySelectorAll('#audio-container audio').forEach(audioEl => {
        const pid = audioEl.getAttribute('data-peer-id');
        const pVol = userVolumes[pid] !== undefined ? userVolumes[pid] : 1.0;
        audioEl.volume = masterVolume * pVol;
    });
}

// ==========================================
// 远端音频渲染 + 分析器
// ==========================================
function addSelfToVoiceUI() {
    const container = document.getElementById('voice-users-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'voice-user';
    div.id = 'voice-user-self';
    const name = window._myName || '我';
    div.innerHTML = `<div class="avatar" style="background:var(--danger); position:relative;">
        ${getInitial(name)}<span class="speaking-dot" id="local-speaking-dot"></span></div>
        <span id="my-voice-name" style="flex:1;">${name}</span>
        <span id="my-voice-mic" style="margin-left:4px;">${getMicIcon(isMicOn)}</span>
        <span id="my-voice-speaker" style="margin-left:4px;">${getSpeakerIcon(isSpeakerOn)}</span>`;
    container.appendChild(div);
}

function setupRemoteAudioUI(peerId, peerName, stream) {
    if (document.getElementById(`vu-${peerId}`)) return;

    // 隐式 audio 标签
    const audio = document.createElement('audio');
    audio.id = `au-${peerId}`;
    audio.setAttribute('data-peer-id', peerId);
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.muted = !isSpeakerOn;
    document.getElementById('audio-container').appendChild(audio);
    // 绕过浏览器 autoplay 限制
    audio.play().catch(e => debugLog('voice', 'audio.play() 被浏览器阻止:', peerId, e.name));

    userVolumes[peerId] = 1.0;
    applyAllVolumes();

    // 远端音频分析器
    try {
        const rCtx = new (window.AudioContext || window.webkitAudioContext)();
        const rSource = rCtx.createMediaStreamSource(stream);
        const rAnalyser = rCtx.createAnalyser();
        rAnalyser.fftSize = CONFIG.VOICE.analyserFftSize;
        rSource.connect(rAnalyser);
        remoteAnalysers[peerId] = {
            ctx: rCtx,
            analyser: rAnalyser,
            dataArray: new Uint8Array(rAnalyser.frequencyBinCount)
        };
    } catch (e) {
        debugLog('voice', '无法为远端创建分析器:', e);
    }

    // 侧边栏 UI
    const container = document.getElementById('voice-users-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'voice-user';
    div.id = `vu-${peerId}`;
    div.title = "点击调节音量";
    const avatarColor = stringToColor(peerId);
    div.innerHTML = `<div class="avatar" style="background:${avatarColor}; position:relative;">
        ${getInitial(peerName)}<span class="speaking-dot" id="speaking-dot-${peerId}"></span></div>
        <span style="flex:1;">${escapeHtml(peerName)}</span>
        <span class="conn-quality" id="conn-quality-${peerId}" title="连接质量"></span>
        <span id="remote-mic-${peerId}" style="margin-left:4px;">🎤</span>
        <span id="remote-speaker-${peerId}" style="margin-left:4px;">🔊</span>`;
    div.onclick = (e) => {
        if (typeof showPersonalVolumePopup === 'function') showPersonalVolumePopup(e, peerId, peerName);
    };
    container.appendChild(div);

    if (typeof updateVoiceStatusBadge === 'function') updateVoiceStatusBadge();
}

function updateRemoteVoiceStatus(peerId, rmMicOn, rmSpeakerOn) {
    const micSpan = document.getElementById(`remote-mic-${peerId}`);
    const speakerSpan = document.getElementById(`remote-speaker-${peerId}`);
    if (micSpan) micSpan.innerHTML = getMicIcon(rmMicOn);
    if (speakerSpan) speakerSpan.innerHTML = getSpeakerIcon(rmSpeakerOn);
}

function removeRemoteAudioUI(peerId) {
    debugLog('voice', 'removeRemoteAudioUI:', peerId);
    document.getElementById(`vu-${peerId}`)?.remove();
    document.getElementById(`au-${peerId}`)?.remove();
    delete userVolumes[peerId];
    if (remoteAnalysers[peerId]) {
        try { remoteAnalysers[peerId].ctx.close(); } catch (e) {}
        delete remoteAnalysers[peerId];
    }
    delete speakingStates[peerId];
    if (meshPeers[peerId]) meshPeers[peerId].voiceCall = null;
    const popup = document.getElementById('personal-vol-popup');
    if (popup && popup.getAttribute('data-target') === peerId) {
        popup.style.display = 'none';
    }

    if (typeof updateVoiceStatusBadge === 'function') updateVoiceStatusBadge();
}

// ==========================================
// 说话指示灯 UI 更新
// ==========================================
function updateLocalSpeakingUI(speaking) {
    const dot = document.getElementById('local-speaking-dot');
    if (dot) dot.classList.toggle('active', speaking);
}

function updateRemoteSpeakingUI(peerId, speaking) {
    const dot = document.getElementById(`speaking-dot-${peerId}`);
    if (dot) dot.classList.toggle('active', speaking);
}

// 根据 peerId 生成固定颜色
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 45%)`;
}

// ==========================================
// 语音流程自检 (浏览器控制台调用: _verifyVoiceFlow())
// ==========================================
window._verifyVoiceFlow = function () {
    var report = [];
    var add = function (label, value, ok) {
        var icon = ok === true ? '✅' : ok === false ? '❌' : '➡️';
        report.push(icon + ' ' + label + ': ' + value);
    };

    add('语音房状态 inVoiceRoom', inVoiceRoom, inVoiceRoom);
    add('window._inVoiceRoom', window._inVoiceRoom);
    add('原始音频流 rawAudioStream', rawAudioStream ? 'active (' + rawAudioStream.getAudioTracks().length + ' tracks)' : 'null', !!rawAudioStream);
    add('处理后音频流 processedAudioStream', processedAudioStream ? 'active (' + processedAudioStream.getAudioTracks().length + ' tracks)' : 'null', !!processedAudioStream);
    add('音频上下文 audioCtx', audioCtx ? audioCtx.state : 'null', audioCtx && audioCtx.state !== 'closed');
    add('麦克风状态 isMicOn', isMicOn, isMicOn);
    add('扬声器状态 isSpeakerOn', isSpeakerOn, isSpeakerOn);
    add('语音检测定时器 speakingCheckInterval', speakingCheckInterval ? 'running' : 'stopped', !!speakingCheckInterval);
    add('本机说话 localSpeaking', localSpeaking);
    add('远端分析器数量 remoteAnalysers', Object.keys(remoteAnalysers).length);
    add('用户音量设置 userVolumes', JSON.stringify(userVolumes));
    add('说话状态 speakingStates', JSON.stringify(speakingStates));

    report.push('---');
    add('Mesh对端总数', Object.keys(meshPeers).length);
    Object.keys(meshPeers).forEach(function (pid) {
        var p = meshPeers[pid];
        var vcStatus = '无语音通话';
        if (p.voiceCall) {
            vcStatus = p.voiceCall.open ? '🟢活跃' : '🔴已关闭';
        }
        add('  对端 ' + (p.name || pid), 'dataConn=' + (p.dataConn && p.dataConn.open ? '🟢' : '🔴') + ' voiceCall=' + vcStatus);
    });

    report.push('---');
    add('语音用户UI (voice-users-container)', document.getElementById('voice-users-container') ? '存在' : '缺失', !!document.getElementById('voice-users-container'));
    add('audio-container', document.getElementById('audio-container') ? '存在' : '缺失', !!document.getElementById('audio-container'));
    add('语音频道按钮状态', document.getElementById('voice-channel-btn') ? document.getElementById('voice-channel-btn').className : '缺失');

    debugLog('voice', '=== 语音流程自检报告 ===');
    report.forEach(function (r) { debugLog('voice', r); });

    return report.join('\n');
};
