# yx99.github.io — 音视频服务器

基于 PeerJS (WebRTC) 的纯前端 Mesh 网络多方通信应用，支持语音通话、文字聊天、屏幕共享，部署于 GitHub Pages。

## 项目概览

- **类型**: 纯静态前端 (Vanilla JS + CSS)，零构建步骤
- **信令**: PeerJS (0.peerjs.com 公共信令服务)
- **穿透**: STUN (Google) + TURN (Metered.ca) 双栈
- **网络拓扑**: Mesh (全连接)，每节点与其他所有节点建立 DataConnection + MediaConnection
- **部署目标**: GitHub Pages (`yx99.github.io`)

## 文件结构

```
yx99.github.io/
├── index.html              # 唯一入口，HTML 骨架 + 外部资源引用
├── CLAUDE.md               # 本文件
├── css/
│   ├── variables.css       # CSS 自定义属性 (颜色/间距/圆角/阴影/字号/过渡)
│   ├── layout.css          # 整体布局: flex 三栏 (侧边栏 | 主内容), 顶栏, 内容体
│   ├── sidebar.css         # 侧边栏: 频道列表, 用户列表, 用户状态栏, 连接诊断区
│   ├── chat.css            # 聊天区: 消息气泡, 系统消息, 输入框
│   ├── video.css           # 视频投屏区 + 手势控制亮度叠加层
│   ├── controls.css        # 按钮/徽章/滑块/弹窗/Toast/语音用户/音量弹窗
│   ├── connection-panel.css # 连接诊断面板样式
│   └── responsive.css      # 响应式断点: >1024px (桌面) / 768-1024px (平板) / <768px (手机)
└── js/
    ├── config.js           # 全局常量: ICE 服务器, 语音参数, 画质预设, 断点值 [只读]
    ├── utils.js            # 工具函数: 剪贴板, localStorage, 格式化, 节流/防抖, XSS 防护
    ├── peer.js             # PeerJS 生命周期: 初始化, TURN 密码, 事件委托
    ├── mesh.js             # Mesh 网络: DataConnection 管理, 握手/发现/解散, 消息路由
    ├── voice.js            # 语音管线: AudioContext → 噪声门 → 增益 → 压缩 → 分析 → 发送
    ├── screen.js           # 投屏管理: 发起/接收/停止 + 投屏音频回放 + 移动端手势
    ├── chat.js             # 聊天: 消息渲染, 发送/接收
    ├── connection-diagnostics.js # 连接诊断: ICE 状态跟踪, P2P/中继检测, RTT, IP 发现
    ├── file-transfer.js    # 文件传输: 分块发送, SHA-256 校验, 拖拽接收
    ├── ui.js               # UI 层: 身份展示, 顶栏状态, 侧边栏折叠, Toast, 快捷键
    └── app.js              # 应用入口: 模块初始化, 事件组装, 流入口路由
```

## JS 模块职责与依赖

### 加载顺序 (index.html script 标签顺序)

1. **config.js** — 最底层，无依赖。`Object.freeze()` 锁定所有常量
2. **utils.js** — 无模块依赖，被所有上层模块使用
3. **peer.js** — 依赖 config (ICE 服务器列表)。暴露 `peer` 单例 + `peerEvents` 回调对象
4. **mesh.js** — 依赖 peer。暴露 `meshPeers` 状态对象 + `meshEvents` 回调
5. **voice.js** — 依赖 peer + mesh。暴露语音管线控制函数
6. **screen.js** — 依赖 peer + mesh。暴露投屏控制 + 手势处理
7. **chat.js** — 依赖 mesh (broadcastData)。暴露消息收发函数
8. **file-transfer.js** — 依赖 mesh (DataConnection)。暴露文件拖拽/发送/接收
9. **connection-diagnostics.js** — 依赖 mesh。暴露 `trackPeerConnection()` + 渲染
10. **ui.js** — 依赖所有上层模块。暴露 DOM 操作 + 快捷键
11. **app.js** — 最顶层，依赖所有模块。组装事件回调，启动应用

### 模块间通信模式

模块间通过以下方式通信，**没有使用 ES 模块导入/导出**：

- **全局变量**: `peer`, `meshPeers`, `inVoiceRoom`, `currentScreenStream`, `myFullId` 等
- **回调对象**: `peerEvents` (onOpen/onConnection/onCall), `meshEvents` (onPeerJoin/onPeerLeave/onMeshChange)
- **全局函数调用**: `broadcastData()`, `appendChat()`, `callVoice()`, `updateTopBarStatus()` 等 — 调用前检查 `typeof xxx === 'function'`
- **window 侧写**: `window._myName`, `window._inVoiceRoom` — 用于跨模块访问关键状态

### 各模块关键导出

| 模块 | 关键全局变量 | 关键全局函数 |
|------|-------------|-------------|
| peer.js | `peer`, `myFullId`, `currentRoomId`, `isHost`, `peerEvents` | `initPeerSystem()`, `getMyId()`, `getRoomId()`, `amIHost()`, `resetToSoloHost()`, `executeDisconnect()` |
| mesh.js | `meshPeers`, `meshEvents` | `connectToMesh()`, `disconnectMesh()`, `setupDataConn()`, `broadcastData()`, `getPeerName()` |
| voice.js | `inVoiceRoom`, `processedAudioStream`, `isMicOn`, `isSpeakerOn`, `speakingStates`, `userVolumes` | `toggleVoiceRoom()`, `callVoice()`, `toggleMic()`, `toggleSpeaker()`, `addSelfToVoiceUI()`, `setupRemoteAudioUI()`, `removeRemoteAudioUI()`, `getSpeakingState()` |
| screen.js | `currentScreenStream`, `outgoingScreenCalls`, `incomingScreenCall` | `toggleShare()`, `stopSharing()`, `hangUpScreen()`, `initScreenGestures()`, `teardownScreenGestures()` |
| chat.js | — | `appendChat()`, `sendChatMessage()`, `handleChatEnter()` |
| file-transfer.js | `sendQueue`, `receiveQueue` | `initFileDropZone()`, `promptSendFile()`, `handleFileOffer()`, `acceptFile()`, `declineFile()` |
| diagnostics | `peerDiagData`, `localNetInfo` | `initConnectionDiagnostics()`, `trackPeerConnection()`, `renderDiagnostics()`, `toggleConnectionPanel()` |
| ui.js | `myName` | `initUI()`, `updateMyIdentityUI()`, `updateTopBarStatus()`, `showToast()`, `toggleSidebar()` |

## 核心数据流

### 1. Mesh 网络建立

```
用户粘贴目标ID → connectToMesh()
  → peer.connect(targetId)           # PeerJS DataConnection
  → setupDataConn(conn)
    → conn.on('open'):
      → 发送 hello { name }          # 握手
      → 发送 mesh-discover { peers } # 告知已知节点
      → broadcastVoiceState()        # 同步语音状态
    → conn.on('data'):
      → hello: 记录名称, 触发 onPeerJoin, 晚进房触发语音呼叫 + 投屏推送
      → mesh-discover: 连接未知节点 (补全 Mesh)
      → voice-state: 同步对方麦克风/扬声器状态, 晚进房语音呼叫
      → room-disband: 房主解散, executeDisconnect()
      → chat / voice-leave / system: 路由到对应处理
      → _ping/_pong: 心跳存活检测

  → DataConnection 存活检测: 每 15s 发送 _ping, 30s 无 _pong 响应则关闭连接
  → broadcastData(): 每次发送包裹 try-catch, 防止单点失败中断广播
```

### 2. 语音管线

```
用户点击"加入语音" → toggleVoiceRoom()
  → getUserMedia({ echoCancellation, noiseSuppression, autoGainControl })
  → 监听 track.onended 检测麦克风拔出，自动退出语音房
  → buildAudioPipeline(stream):
      MediaStreamSource
        → GainNode (noiseGate)         # 噪声门, 当前未主动处理
        → GainNode (micGain)           # 麦克风增益 (初始 1.0, 滑块 0-2 中间值)
        → DynamicsCompressorNode       # 动态压缩 (threshold:-15dB, ratio:2)
        → AnalyserNode                 # 音量检测 → 驱动说话指示灯
        → MediaStreamDestination       # 输出给 PeerJS
  → callVoice(peerId) × N             # 向所有 Mesh 对端发起 MediaConnection
  → 接收端 peerEvents.onCall('voice'):
    → call.answer(processedAudioStream)
    → call.on('stream') → setupRemoteAudioUI():
      → 创建 <audio> 标签, audio.play()
      → 创建远端 AnalyserNode → 检测对方说话状态
```

**默认音量**: 主音量初始 0.5 (滑块中间值), 麦克风增益初始 1.0 (滑块中间值), 便于上下调整。

### 3. 投屏流转

```
发起投屏:
  toggleShare() → getDisplayMedia({ video, audio: systemAudio })
  → 存储画质参数 (quality, qualityLabel) 到元数据
  → peer.call(pid, stream) × N        # 向所有对端发送
  → stream.getVideoTracks().forEach(track => track.onended = stopSharing)
  → 轮询获取 PC 用于诊断 (每 300ms, 最多 20 次)

接收投屏:
  peerEvents.onCall('screen'):
    → call.answer()
    → call.on('stream'):
      → stream → <video> 元素 (完整流, 音视频不分离)
        → playsInline = true, play() (绕过平板 autoplay 限制)
        → 原生音量控件直接控制 video.volume, 不再灰掉
      → 画质角标: onloadedmetadata + 2s 定时检测分辨率
      → initScreenGestures()           # 移动端手势: 亮度/音量
      → trackPeerConnection()          # 连接诊断

晚进房投屏: mesh.js hello 处理中检测 currentScreenStream, 自动向新节点发起
  投屏 call (携带画质元数据), 轮询获取 PC 用于诊断

**投屏音量控制**: 完整流直接给 `<video>` 元素，原生音量控件正常工作。手势调节音量时直接设置 `video.volume`，与原生控件天然同步。

### 4. 晚进房机制 (voice-state / hello 触发)

当新节点加入 Mesh 时，已在语音房的其他节点会自动向它发起语音呼叫：

- **路径 A**: `hello` 消息处理中检查 `window._inVoiceRoom` → `callVoice()`
- **路径 B**: `voice-state` 消息处理中检查 `window._inVoiceRoom` 且 `!voiceCall` → `callVoice()`
- **防护**: `callVoice()` 内部检查 `voiceCall.open` 防止重复呼叫

### 5. 文件传输协议

```
发送方拖入文件 → promptSendFile() → 选择目标对端
  → sendFileToPeer(pid, file):
    → 读取 ArrayBuffer → computeHash() SHA-256
    → 发送 file-offer { name, size, hash, chunkCount }
    → 等待 file-accept (30s 超时自动取消)
    → startSendingChunks(): 每 5 块暂停 50ms 节流
      每个 chunk: { type:'file-chunk', id, index, data: base64(10KB) }
    → 最后一块携带 hash 供接收方校验
    → 等待 file-ack 确认

接收方:
  mesh.js 路由 file-offer → handleFileOffer():
    → appendFileReceiveMsg() 渲染文件消息卡片 (接受/拒绝按钮)
    → acceptFile(): 发送 file-accept, 准备接收缓冲区
    → 每收到 file-chunk: 解码 base64 → 写入缓冲区 → 更新进度
    → 收到 file-done: assembleAndDownload()
      → 拼接 Uint8Array → computeHash() 比对 → Blob 下载
    → declineFile(): 发送 file-decline, 清理缓冲区
```

**完整性保证**: SHA-256 哈希校验确保文件完整正确。分块大小 10KB (raw)，base64 编码后约 13.7KB 每块。发送节流防止 DataChannel 缓冲区溢出。

## ICE / 连接诊断

`connection-diagnostics.js` 通过 WebRTC Stats API 采集连接信息：

```
trackPeerConnection(peerId, pc)
  → 防重复: peerDiagData[peerId]._tracked 标记
  → pc.oniceconnectionstatechange → renderDiagnostics()
    → failed/disconnected 后 8s 宽限期, 超时自动关闭 voiceCall 并清理 UI
  → setInterval(3s):
      pc.getStats()
        → 找 nominated=true, state=succeeded 的 candidate-pair
        → 读取 currentRoundTripTime (RTT)
        → 判断 localCandidateType/remoteCandidateType 是否为 'relay'
        → 提取 local/remote IP
        → 提取 codec (mimeType), audio bitrate, packetsLost
```

**PC 获取策略**: PeerJS 的 `peerConnection` 并非立即可用。DataConnection 和 outgoing MediaConnection 使用轮询 (每 300ms, 最多 20 次)；incoming MediaConnection 在 `call.on('stream')` 中获取 (answer 后 PC 必已就绪)。

- **P2P 直连判定**: candidate pair 的 local 和 remote 类型都不是 `relay`
- **中继判定**: 任一端类型为 `relay`
- **RTT 分级**: <50ms good / 50-150ms ok / >150ms poor

## 设计决策与约束

### 为什么使用全局变量而非 ES 模块

GitHub Pages 部署不做打包构建，浏览器直接加载 `<script>` 标签。使用全局变量和回调对象是唯一可行的模块间通信方式。

### 为什么在调用上层函数前检查 typeof

模块按依赖顺序加载，但 init 时机不同步。例如 `mesh.js` 在 `voice.js` 前加载，`mesh.js` 中的 handler 可能引用 `voice.js` 的函数，这些 handler 在数据到达时才执行，此时 `voice.js` 已加载完毕。`typeof` 检查是安全网，防止加载时序的边界情况。

### 为什么同时存在 DataConnection 和 MediaConnection

- **DataConnection** (`mesh.js`): 传输聊天消息、mesh 发现、语音状态同步、房间解散等控制信号。总是建立。
- **MediaConnection** (`voice.js`, `screen.js`): 传输音视频流。只在使用语音/投屏时按需建立。

两者组合使用，不会相互替代。

### 投屏音频不分离

早期尝试将音频轨道分离开通过 AudioContext 回放以保证音质，但这导致 `<video>` 元素没有音频轨道，原生音量控件被浏览器灰掉失效。改回完整流直接给 `<video>`，音量控件正常工作，手势和控件统一读写 `video.volume`，简洁且没有可感知的音质差异。`setupScreenAudio` / `screenAudioGain` 保留但不再被投屏流程调用。

### PeerJS 重连 ID 变更

PeerJS 断线重连后可能分配到新的 peer ID。`peer.js` 在 `on('open')` 中检测 ID 变更：若新 ID 与旧 ID 不同，说明旧连接已失效，自动执行 `executeDisconnect()` 清理所有 mesh 连接、语音通话和投屏状态，并重置 UI。

### 压缩器参数保守化

`compressorThreshold: -15dB` 仅压缩较大音量，避免背景噪声被放大。`ratio: 2` 轻量压缩保留自然动态。`knee: 5` 起效边界锐利。

## 开发约定

### 代码风格

- 缩进: 4 空格
- 引号: 单引号 `'`
- 函数声明: `function name() {}` (不用箭头函数做顶层声明)
- 字符串模板: 仅在有变量插值时使用反引号
- 无分号结尾 (部分文件不一致，新代码不加)
- 模块头注释: `// ==========================================` 分隔线 + 模块名

### CSS 约定

- 使用 CSS 变量，定义在 `variables.css`
- 选择器命名: kebab-case
- 状态用 class 切换 (`.open`, `.active`, `.muted`)，不用 inline style
- 响应式断点统一在 `responsive.css` 管理
- 弹窗/浮层不要放在 `overflow: hidden` 的容器内，否则会被裁剪。`.sidebar` 不自设 overflow，由 `.channel-list` 和 `.diag-section` 各自管理滚动

### 安全注意事项

- 所有用户输入在渲染 HTML 前必须经过 `escapeHtml()`
- 不要将用户输入直接拼接 HTML 字符串
- localStorage 读写使用 `storageGet`/`storageSet` 包装 try-catch
- TURN 密码存储在 localStorage，非敏感但仍需用户确认

### 调试

- `debugLog(tag, ...args)` — 所有模块使用此函数输出带标签日志
- `console.log` 仅用于 `debugLog` 内部和 `peer.js` 错误处理
- 浏览器控制台 `_verifyVoiceFlow()` 输出语音子系统的完整状态

## 响应式设计

| 断点 | 宽度 | 侧边栏 | 视频区 | 关键适配 |
|------|------|--------|--------|---------|
| 桌面 | >1024px | 固定 260px (可拖拽 180-500px) | max-height:50% | 默认布局, 顶栏固定高度 |
| 平板 | 768-1024px | 缩窄至 200px | max-height:45% / min-height:200px | 顶栏横向滚动不换行, 缩小字体/按钮 |
| 手机 | <768px | 滑入抽屉 (translateX -100%) | max-height:30vh / min-height:180px | 汉堡菜单, 顶栏横向滚动, 触控 44px |
| 极小屏 | <400px | 全宽抽屉 | min-height:150px | 按钮更紧凑 |

平板和手机的顶栏使用 `overflow-x: auto; flex-wrap: nowrap` 横向滚动，避免按钮被裁剪。

移动端投屏观看时，支持触摸手势：左半屏上下滑调亮度（叠加半透明黑色层），右半屏上下滑调音量（控制 screenAudioGain）。手势避开底部 15% 区域以免与原生视频控件冲突。调整时屏幕中央显示百分比指示器。
