// ==========================================
// connection-diagnostics.js — 连接诊断
// ==========================================

// 每节点连接诊断数据
let peerDiagData = {}; // { peerId: { iceState, connectionType, candidates[], rtt } }
let localNetInfo = { ipv4: [], ipv6: [] };

// ==========================================
// 本机 IP 发现 (通过 RTCPeerConnection)
// ==========================================
async function discoverLocalIPs() {
    return new Promise((resolve) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        const candidates = [];
        const timeout = setTimeout(() => {
            pc.close();
            resolve(candidates);
        }, 3000);

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                candidates.push(e.candidate);
            } else {
                clearTimeout(timeout);
                pc.close();
                resolve(candidates);
            }
        };

        pc.createDataChannel('ipcheck');
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
    });
}

function parseLocalCandidates(candidates) {
    localNetInfo = { ipv4: [], ipv6: [] };
    candidates.forEach(c => {
        if (!c.candidate) return;
        const parts = c.candidate.split(' ');
        const addr = parts[4];
        const type = parts[7];
        if (!addr) return;
        if (addr.includes(':')) {
            if (!localNetInfo.ipv6.find(x => x.addr === addr)) {
                localNetInfo.ipv6.push({ addr, type });
            }
        } else {
            if (!localNetInfo.ipv4.find(x => x.addr === addr)) {
                localNetInfo.ipv4.push({ addr, type });
            }
        }
    });
}

// ==========================================
// 启动本机 IP 发现并渲染面板
// ==========================================
async function initConnectionDiagnostics() {
    try {
        const candidates = await discoverLocalIPs();
        parseLocalCandidates(candidates);
    } catch (e) {
        debugLog('diag', '本机 IP 发现失败:', e);
    }
    renderLocalNetInfo();
}

// ==========================================
// 跟踪对端连接状态
// ==========================================
function trackPeerConnection(peerId, pc) {
    if (!pc) return;

    if (!peerDiagData[peerId]) {
        peerDiagData[peerId] = {
            iceState: 'new',
            connectionType: 'unknown',
            candidates: [],
            rtt: null,
            localCandidates: [],
            remoteCandidates: []
        };
    }

    const diag = peerDiagData[peerId];

    pc.oniceconnectionstatechange = () => {
        diag.iceState = pc.iceConnectionState;
        updatePeerDiagUI(peerId);
        updateConnectionQualityIcon(peerId);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            const parts = e.candidate.candidate.split(' ');
            const addr = parts[4];
            const type = parts[7];
            diag.candidates.push({
                addr,
                type,
                protocol: parts[2]?.toLowerCase(),
                local: true
            });
            updatePeerDiagUI(peerId);
        }
    };

    // 周期性获取 stats (RTT / 选定对)
    const statsInterval = setInterval(async () => {
        if (!meshPeers[peerId]) { clearInterval(statsInterval); return; }
        try {
            const stats = await pc.getStats();
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    diag.rtt = report.currentRoundTripTime
                        ? (report.currentRoundTripTime * 1000).toFixed(1)
                        : null;
                    diag.connectionType = report.localCandidateType === 'relay' ||
                                          report.remoteCandidateType === 'relay'
                        ? 'relay' : 'p2p';
                }
                // 收集远端候选
                if (report.type === 'remote-candidate') {
                    const exists = diag.remoteCandidates.find(c => c.addr === report.ip);
                    if (!exists && report.ip) {
                        diag.remoteCandidates.push({
                            addr: report.ip,
                            type: report.candidateType,
                            protocol: report.protocol?.toLowerCase()
                        });
                    }
                }
            });
            updatePeerDiagUI(peerId);
            updateConnectionQualityIcon(peerId);
        } catch (e) { /* stats 获取失败，忽略 */ }
    }, 3000);
}

// ==========================================
// 更新侧边栏连接质量图标
// ==========================================
function updateConnectionQualityIcon(peerId) {
    const el = document.getElementById(`conn-quality-${peerId}`);
    if (!el) return;
    const diag = peerDiagData[peerId];
    if (!diag) return;

    let icon = '';
    let title = '';
    let cls = '';

    switch (diag.iceState) {
        case 'connected':
            if (diag.connectionType === 'p2p') {
                icon = '🟢';
                title = 'P2P 直连';
                cls = 'p2p';
            } else if (diag.connectionType === 'relay') {
                icon = '🟡';
                title = 'TURN 中继';
                cls = 'relay';
            } else {
                icon = '🟢';
                title = '已连接';
                cls = 'p2p';
            }
            break;
        case 'checking':
            icon = '🟠';
            title = '连接中...';
            cls = '';
            break;
        case 'new':
            icon = '⚪';
            title = '等待连接';
            cls = '';
            break;
        case 'disconnected':
        case 'failed':
        case 'closed':
            icon = '🔴';
            title = '连接断开';
            cls = 'off';
            break;
        default:
            icon = '⚪';
            title = diag.iceState;
    }

    el.innerHTML = icon;
    el.title = title;
    el.className = 'conn-quality ' + cls;
}

// ==========================================
// UI 渲染
// ==========================================
function renderLocalNetInfo() {
    const container = document.getElementById('local-net-info');
    if (!container) return;

    let html = '';
    localNetInfo.ipv4.forEach(c => {
        html += `<div class="net-info-row">
            <span class="label">IPv4</span>
            <span class="value">${escapeHtml(c.addr)}</span>
            <span class="ice-candidate-tag ${c.type}">${c.type}</span>
        </div>`;
    });
    localNetInfo.ipv6.forEach(c => {
        html += `<div class="net-info-row">
            <span class="label">IPv6</span>
            <span class="value">${escapeHtml(c.addr)}</span>
            <span class="ice-candidate-tag ${c.type}">${c.type}</span>
        </div>`;
    });
    if (!html) {
        html = '<div class="net-info-row"><span class="value">发现中...</span></div>';
    }
    container.innerHTML = html;
}

function updatePeerDiagUI(peerId) {
    const container = document.getElementById('peer-diag-list');
    if (!container) return;
    const diag = peerDiagData[peerId];
    if (!diag) return;

    const name = getPeerName(peerId);
    const stateClass = diag.iceState;
    const stateLabel = {
        'new': '等待', 'checking': '连接中', 'connected': '已连接',
        'disconnected': '断开', 'failed': '失败', 'closed': '关闭'
    }[diag.iceState] || diag.iceState;

    const connType = diag.connectionType || 'unknown';
    const connTypeLabel = connType === 'p2p' ? 'P2P 直连' : connType === 'relay' ? 'TURN 中继' : '检测中';
    const rttStr = diag.rtt ? `${diag.rtt} ms` : '—';

    let entry = document.getElementById(`diag-${peerId}`);
    if (!entry) {
        entry = document.createElement('div');
        entry.id = `diag-${peerId}`;
        entry.className = 'peer-diag-entry';
        container.appendChild(entry);
    }

    entry.innerHTML = `
        <div class="peer-diag-header">
            <span class="peer-diag-name">${escapeHtml(name)}</span>
            <span class="peer-diag-status ${stateClass}">${stateLabel}</span>
        </div>
        <div class="peer-diag-details">
            <div>连接方式: <span class="conn-type ${connType}">${connTypeLabel}</span>  |  延迟: ${rttStr}</div>
            ${renderCandidateLines(diag)}
        </div>`;
}

function renderCandidateLines(diag) {
    let lines = '';
    diag.candidates.forEach(c => {
        const ipv = c.addr && c.addr.includes(':') ? 'v6' : 'v4';
        lines += `<div class="candidate-line">
            <span class="ice-candidate-tag ${c.type}">${c.type}</span>
            IPv${ipv}: ${escapeHtml(c.addr || '?')} (${c.protocol || '?'})
        </div>`;
    });
    if (diag.remoteCandidates && diag.remoteCandidates.length > 0) {
        diag.remoteCandidates.forEach(c => {
            const ipv = c.addr && c.addr.includes(':') ? 'v6' : 'v4';
            lines += `<div class="candidate-line">
                <span class="ice-candidate-tag ${c.type}">远端-${c.type}</span>
                IPv${ipv}: ${escapeHtml(c.addr || '?')} (${c.protocol || '?'})
            </div>`;
        });
    }
    return lines;
}

function toggleConnectionPanel() {
    const panel = document.getElementById('connection-panel');
    if (panel) panel.classList.toggle('open');
}
