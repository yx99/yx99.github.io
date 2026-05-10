const myIdDisplay = document.getElementById('my-id');
const remoteVideo = document.getElementById('remote-video');
let peer;
let incomingCall = null; // 记住当前接听的通话

// ==========================================
// 1. 安全配置区域：从本地缓存读取 TURN 密码
// ==========================================
let turnPassword = localStorage.getItem('my_turn_password');

// 如果本地没有密码，弹窗询问并保存
if (!turnPassword) {
    turnPassword = prompt("【安全提示】\n请输入 Metered TURN 服务器的 Credential 密码：\n（密码仅保存在您的本地浏览器中，不会上传。若不输入点击取消，将只尝试 P2P 直连）");
    if (turnPassword) {
        localStorage.setItem('my_turn_password', turnPassword);
    } else {
        console.warn("未输入中转密码，只使用免费 STUN 进行 P2P 穿透。");
    }
}

// ==========================================
// 2. 初始化 Peer (修复 GitHub Pages 连接信令失败问题)
// ==========================================
const peerConfig = {
    host: '0.peerjs.com', // 强制指定官方安全服务器
    port: 443,            // 使用 443 安全端口
    secure: true,         // 强制 HTTPS/WSS
    config: {
        'iceTransportPolicy': 'all',
        'iceServers': [
            // 免费 STUN (必须保留，用于免费 P2P 直连)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    }
};

// 如果用户输入了密码，才将 Metered TURN 中转服务器加入配置
if (turnPassword) {
    peerConfig.config.iceServers.push(
        {
            urls: 'turn:standard.relay.metered.ca:80',
            username: '24a3487d75b2f7131db44b6a',
            credential: turnPassword       // 密码动态读取，代码不泄露
        },
        {
            urls: "turn:standard.relay.metered.ca:80?transport=tcp",
            username: "24a3487d75b2f7131db44b6a",
            credential: turnPassword
        },
        {
            urls: 'turn:standard.relay.metered.ca:443',
            username: '24a3487d75b2f7131db44b6a',
            credential: turnPassword
        },
        {
            urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
            username: '24a3487d75b2f7131db44b6a', 
            credential: turnPassword
        },
    );
}

peer = new Peer(peerConfig);

// 当连接到 PeerJS 服务器成功时，显示我的 ID
peer.on('open', (id) => {
    myIdDisplay.innerText = id;
    console.log('成功连接信令服务器！我的 Peer ID 是: ' + id);
});

// 作为【接收端】：监听别人的呼叫
peer.on('call', (call) => {
    console.log('收到画面呼叫，正在接通...');
    incomingCall = call; // 🌟 把通话对象存起来
    
    call.answer(); // 接听
    
    call.on('stream', (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        // 显示挂断按钮
        document.getElementById('hangup-btn').style.display = 'inline-block';
    });

    // 监听对方挂断或网络断开
    call.on('close', () => {
        alert("对方已停止投屏或连接断开");
        remoteVideo.srcObject = null;
        document.getElementById('hangup-btn').style.display = 'none';
    });
});

// 🌟 新增：接收端主动挂断的功能
function hangUp() {
    if (incomingCall) {
        incomingCall.close(); // 这行代码是真正停止流量的关键！
        incomingCall = null;
        remoteVideo.srcObject = null;
        document.getElementById('hangup-btn').style.display = 'none';
        console.log("已主动断开连接，流量已停止传输。");
    }
}

// ==========================================
// 4. 作为【发起端】：捕获屏幕、压缩画质并发送，支持启停控制
// ==========================================
let currentStream = null; // 用于记录当前的屏幕流
let currentCall = null;   // 用于记录当前的通话对象
const shareBtn = document.getElementById('share-btn');

async function toggleShare() {
    // 如果当前已经在共享，则执行停止逻辑
    if (currentStream) {
        stopSharing();
        return;
    }

    // --- 以下为发起共享逻辑 ---
    const targetId = document.getElementById('remote-id').value;
    if (!targetId) return alert("请输入朋友的 ID！");

    const qualitySetting = document.getElementById('video-quality').value;
    let videoConstraints = { cursor: "always" };

    switch (qualitySetting) {
        case '1080p':
            videoConstraints.width = { max: 1920 };
            videoConstraints.height = { max: 1080 };
            videoConstraints.frameRate = { max: 30 };
            break;
        case '720p':
            videoConstraints.width = { max: 1280 };
            videoConstraints.height = { max: 720 };
            videoConstraints.frameRate = { max: 30 };
            break;
        case '480p':
            videoConstraints.width = { max: 854 };
            videoConstraints.height = { max: 480 };
            videoConstraints.frameRate = { max: 15 }; 
            break;
        case 'auto':
        default:
            videoConstraints = true; 
            break;
    }

    try {
        console.log("正在请求屏幕权限，画质策略:", qualitySetting);
        
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
            audio: {
                systemAudio: "include", 
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        // 记录当前流
        currentStream = stream;
        
        console.log('正在推送屏幕流给: ' + targetId);
        currentCall = peer.call(targetId, stream);
        
        // 🌟 共享成功，更新按钮 UI 为红色停止按钮
        shareBtn.innerText = "🛑 停止投屏";
        shareBtn.classList.add("btn-danger");
        
        // 🌟 新增：监听接收端主动挂断连接
        currentCall.on('close', () => {
            console.log("检测到对方断开了连接");
            alert("对方已挂断，投屏已自动停止。");
            stopSharing(); // 自动调用停止逻辑，这会让浏览器底层的屏幕抓取也立刻停掉
        });
        
        // 监听浏览器自带悬浮条的“停止共享”事件
        
        // 监听浏览器自带悬浮条的“停止共享”事件
        stream.getVideoTracks()[0].onended = () => {
            console.log("检测到系统底层结束了屏幕共享");
            stopSharing(); // 同步重置按钮状态
        };

    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.warn("用户取消了共享");
        } else {
            console.error("无法获取屏幕流: ", err);
            alert("屏幕捕获失败，请检查浏览器权限。");
        }
    }
}

// ==========================================
// 5. 辅助函数：停止共享并恢复 UI
// ==========================================
function stopSharing() {
    // 停止所有的媒体轨道（关闭麦克风、停止捕获屏幕）
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
    
    // 断开 PeerJS 的连接
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    
    // 🌟 恢复按钮 UI 为初始状态
    shareBtn.innerText = "🚀 发起屏幕共享";
    shareBtn.classList.remove("btn-danger");
}
