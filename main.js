const myIdDisplay = document.getElementById('my-id');
const remoteVideo = document.getElementById('remote-video');
let peer;

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

// ==========================================
// 3. 作为【接收端】：监听并播放对方发来的画面
// ==========================================
peer.on('call', (call) => {
    console.log('收到画面呼叫，正在接通...');
    call.answer(); // 接听
    call.on('stream', (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
    });
});

// ==========================================
// 4. 作为【发起端】：捕获屏幕、压缩画质并发送
// ==========================================
async function startShare() {
    const targetId = document.getElementById('remote-id').value;
    if (!targetId) return alert("请输入朋友的 ID！");

    // 读取用户选择的画质
    const qualitySetting = document.getElementById('video-quality').value;
    let videoConstraints = { cursor: "always" };

    // 根据选择应用分辨率和帧率限制 (硬件级压缩)
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
        case '480p': // 省流模式
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
        
        // 唤起系统级屏幕共享选择框
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
            audio: {
                systemAudio: "include", 
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        console.log('正在推送屏幕流给: ' + targetId);
        const call = peer.call(targetId, stream);
        
        // 处理流结束（当用户点击浏览器顶部的“停止共享”时）
        stream.getVideoTracks()[0].onended = () => {
            alert("屏幕共享已结束");
            call.close();
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