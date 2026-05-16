// ==========================================
// peer.js — PeerJS 初始化与信令管理
// ==========================================
let peer;
let myFullId = '';
let currentRoomId = '';
let isHost = true;

// 事件回调注册
const peerEvents = {
    onOpen: null,
    onConnection: null,
    onCall: null,
    onError: null
};

function initPeerSystem() {
    const turnPassword = storageGet(CONFIG.STORAGE_KEYS.TURN_PASSWORD);
    if (!turnPassword) {
        const pw = prompt("【安全提示】\n请输入服务器密码：\n(密码仅保存在本地。若不输入点击取消，跨网可能无法投屏)");
        if (pw) storageSet(CONFIG.STORAGE_KEYS.TURN_PASSWORD, pw);
    }

    const storedPw = storageGet(CONFIG.STORAGE_KEYS.TURN_PASSWORD);
    const iceServers = [...CONFIG.STUN_SERVERS];
    if (storedPw) {
        CONFIG.TURN_SERVER.urls.forEach(url => {
            iceServers.push({
                urls: url,
                username: CONFIG.TURN_SERVER.username,
                credential: storedPw
            });
        });
    }

    peer = new Peer({
        host: CONFIG.SIGNALING.host,
        port: CONFIG.SIGNALING.port,
        secure: CONFIG.SIGNALING.secure,
        config: {
            iceTransportPolicy: 'all',
            iceServers: iceServers
        }
    });

    peer.on('open', id => {
        myFullId = id;
        currentRoomId = id;
        debugLog('peer', '信令已连接, ID:', id);
        if (peerEvents.onOpen) peerEvents.onOpen(id);
    });

    peer.on('connection', conn => {
        debugLog('peer', '收到 DataConnection:', conn.peer);
        if (peerEvents.onConnection) peerEvents.onConnection(conn);
    });

    peer.on('call', call => {
        debugLog('peer', '收到 MediaConnection:', call.peer, call.metadata);
        if (peerEvents.onCall) peerEvents.onCall(call);
    });

    peer.on('error', err => {
        console.error('PeerJS 错误:', err);
        if (err.type === 'peer-unavailable') {
            alert("找不到目标 ID，请检查输入是否正确。");
        }
        if (peerEvents.onError) peerEvents.onError(err);
    });

    peer.on('disconnected', () => {
        debugLog('peer', '信令断开，尝试重连...');
        peer.reconnect();
    });
}

function getPeer() { return peer; }
function getMyId() { return myFullId; }
function getRoomId() { return currentRoomId; }
function setRoomId(id) { currentRoomId = id; }
function amIHost() { return isHost; }
function setHost(val) { isHost = val; }

// 重置为独立房主
function resetToSoloHost() {
    isHost = true;
    currentRoomId = myFullId;
}
