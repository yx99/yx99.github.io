// ==========================================
// config.js — 全局配置常量
// ==========================================
const CONFIG = {
    // TURN 服务器 (跨网穿透)
    TURN_SERVER: {
        urls: [
            'turn:standard.relay.metered.ca:80',
            'turn:standard.relay.metered.ca:443'
        ],
        username: '24a3487d75b2f7131db44b6a'
    },

    // STUN 服务器
    STUN_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],

    // PeerJS 信令服务器
    SIGNALING: {
        host: '0.peerjs.com',
        port: 443,
        secure: true
    },

    // 语音处理参数
    VOICE: {
        noiseGateThreshold: 0.01,    // 噪声门阈值 (0-1)
        noiseGateHoldMs: 300,        // 噪声门保持时间
        compressorThreshold: -30,    // 压缩器阈值 (dB)
        compressorRatio: 3,          // 压缩比
        compressorKnee: 10,          // 压缩拐点
        attackMs: 5,                 // 攻击时间
        releaseMs: 100,              // 释放时间
        speakingThreshold: 0.02,     // 语音检测阈值
        speakingHoldMs: 500,         // 语音检测保持时间
        analyserFftSize: 256,        // 分析器 FFT 大小
        defaultMicGain: 1.0,         // 默认麦克风增益
        defaultMasterVolume: 1.0     // 默认主音量
    },

    // 视频画质预设
    VIDEO_QUALITY: {
        '1080p60': { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } },
        '1080p':   { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } },
        '720p':    { width: { max: 1280 }, height: { max: 720 },  frameRate: { max: 30 } },
        '480p':    { width: { max: 854 },  height: { max: 480 },  frameRate: { max: 15 } },
        'auto':    { width: { max: 1920, ideal: 1920 }, height: { max: 1080, ideal: 1080 }, frameRate: { max: 30 } }
    },

    // 响应式断点
    BP_TABLET: 1024,
    BP_MOBILE: 768,

    // Toast 持续时间 (ms)
    TOAST_DURATION: 3000,

    // 用户名 localStorage key
    STORAGE_KEYS: {
        USERNAME: 'geek_username',
        TURN_PASSWORD: 'my_turn_password'
    }
};

// 防止意外修改
Object.freeze(CONFIG);
Object.freeze(CONFIG.VOICE);
Object.freeze(CONFIG.SIGNALING);
Object.freeze(CONFIG.STORAGE_KEYS);
