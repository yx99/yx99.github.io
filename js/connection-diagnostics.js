// ==========================================
// connection-diagnostics.js — 连接诊断
// ==========================================

// 每节点连接诊断数据
let peerDiagData = {}; // { peerId: { iceState, connectionType, candidates[], rtt, ipv4, ipv6 } }
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
    renderDiagnostics();
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
            localIp: null,
            remoteIp: null,
            rtt: null
        };
    }

    const diag = peerDiagData[peerId];

    pc.oniceconnectionstatechange = () => {
        diag.iceState = pc.iceConnectionState;
        renderDiagnostics();
        updateConnectionQualityIcon(peerId);
    };

    // 周期性获取 stats — 仅关注 nominated 的对以确保准确
    const statsInterval = setInterval(async () => {
        if (!meshPeers[peerId]) { clearInterval(statsInterval); return; }
        try {
            const stats = await pc.getStats();
            // 找到被 ICE 选中的候选对 (nominated=true, state=succeeded)
            let nominatedPair = null;
            const localCandidates = {};
            const remoteCandidates = {};

            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
                    nominatedPair = report;
                }
                if (report.type === 'local-candidate' && report.id) {
                    localCandidates[report.id] = report;
                }
                if (report.type === 'remote-candidate' && report.id) {
                    remoteCandidates[report.id] = report;
                }
            });

            // 如果没找到 nominated，退而求其次用第一个 succeeded
            if (!nominatedPair) {
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && !nominatedPair) {
                        nominatedPair = report;
                    }
                });
            }

            if (nominatedPair) {
                diag.rtt = nominatedPair.currentRoundTripTime
                    ? (nominatedPair.currentRoundTripTime * 1000).toFixed(0)
                    : null;
                const isRelay = nominatedPair.localCandidateType === 'relay' ||
                                nominatedPair.remoteCandidateType === 'relay';
                diag.connectionType = isRelay ? 'relay' : 'p2p';

                // 仅显示实际使用的 IP
                const localCand = localCandidates[nominatedPair.localCandidateId];
                const remoteCand = remoteCandidates[nominatedPair.remoteCandidateId];
                if (localCand && localCand.ip) diag.localIp = localCand.ip;
                if (remoteCand && remoteCand.ip) diag.remoteIp = remoteCand.ip;
            }

            renderDiagnostics();
            updateConnectionQualityIcon(peerId);
        } catch (e) { /* 忽略 stats 获取失败 */ }
    }, 3000);
}

// ==========================================
// 诊断面板渲染 (简洁可读)
// ==========================================
function renderDiagnostics() {
    renderLocalNetInfo();
    renderPeerDiagList();
}

function renderLocalNetInfo() {
    const container = document.getElementById('local-net-info');
    if (!container) return;

    // 仅显示公网地址 (srflx)，过滤掉内网地址
    const publicV4 = localNetInfo.ipv4.filter(c => c.type === 'srflx');
    const publicV6 = localNetInfo.ipv6.filter(c => c.type === 'srflx');
    const hostV4 = localNetInfo.ipv4.filter(c => c.type === 'host');

    let html = '';
    if (publicV4.length > 0) {
        html += `<div class="diag-row"><span class="diag-label">公网</span><span class="diag-value">${escapeHtml(publicV4.map(c => c.addr).join(', '))}</span></div>`;
    } else if (hostV4.length > 0) {
        html += `<div class="diag-row"><span class="diag-label">内网</span><span class="diag-value">${escapeHtml(hostV4[0].addr)}</span></div>`;
    }
    if (publicV6.length > 0) {
        html += `<div class="diag-row"><span class="diag-label">IPv6</span><span class="diag-value">${escapeHtml(publicV6[0].addr)}</span></div>`;
    }
    if (!html) {
        html = '<div class="diag-row"><span class="diag-value dim">检测中...</span></div>';
    }
    container.innerHTML = html;
}

function renderPeerDiagList() {
    const container = document.getElementById('peer-diag-list');
    if (!container) return;

    const peerIds = Object.keys(meshPeers);
    if (peerIds.length === 0) {
        container.innerHTML = '<div class="diag-empty">暂无对端连接</div>';
        return;
    }

    // 统计
    let p2pCount = 0, relayCount = 0, unknownCount = 0;
    peerIds.forEach(pid => {
        const d = peerDiagData[pid];
        if (!d || d.connectionType === 'unknown') unknownCount++;
        else if (d.connectionType === 'p2p') p2pCount++;
        else relayCount++;
    });

    let html = '<div class="diag-summary">';
    html += `<span>对端 ${peerIds.length} 个</span>`;
    if (p2pCount > 0) html += `<span class="diag-dot p2p"></span><span>P2P直连 ${p2pCount}</span>`;
    if (relayCount > 0) html += `<span class="diag-dot relay"></span><span>中继 ${relayCount}</span>`;
    if (unknownCount > 0) html += `<span class="diag-dot unknown"></span><span>检测中 ${unknownCount}</span>`;
    html += '</div>';

    peerIds.forEach(pid => {
        const diag = peerDiagData[pid];
        const name = getPeerName(pid);
        html += renderPeerDiagEntry(pid, name, diag);
    });

    container.innerHTML = html;
}

function renderPeerDiagEntry(peerId, name, diag) {
    // 状态图标和文字
    let statusIcon, statusText, statusCls;
    switch (diag?.iceState) {
        case 'connected':
            statusIcon = '●'; statusText = '已连接'; statusCls = 'connected'; break;
        case 'checking':
            statusIcon = '◐'; statusText = '协商中'; statusCls = 'checking'; break;
        case 'new':
            statusIcon = '○'; statusText = '等待'; statusCls = 'new'; break;
        case 'disconnected':
            statusIcon = '✕'; statusText = '断开'; statusCls = 'disconnected'; break;
        case 'failed':
            statusIcon = '✕'; statusText = '失败'; statusCls = 'failed'; break;
        default:
            statusIcon = '○'; statusText = diag?.iceState || '未知'; statusCls = 'new';
    }

    // 连接方式
    let connInfo = '';
    if (diag?.connectionType === 'p2p') {
        connInfo = '<span class="diag-conn-type p2p">⚡ 直连</span>';
    } else if (diag?.connectionType === 'relay') {
        connInfo = '<span class="diag-conn-type relay">🔄 中继转发</span>';
    } else {
        connInfo = '<span class="diag-conn-type unknown">… 检测中</span>';
    }

    // RTT 延迟
    let rttInfo = '';
    if (diag?.rtt) {
        const rtt = parseInt(diag.rtt);
        const rttCls = rtt < 50 ? 'good' : rtt < 150 ? 'ok' : 'poor';
        rttInfo = `<span class="diag-rtt ${rttCls}">${rtt}ms</span>`;
    }

    // IP 信息 — 仅显示活跃连接的地址
    let ipInfo = '';
    if (diag?.remoteIp) {
        ipInfo += `<span class="diag-ip">远端 ${escapeHtml(diag.remoteIp)}</span>`;
    }
    if (diag?.localIp && diag.connectionType === 'relay') {
        ipInfo += `<span class="diag-ip">本端 ${escapeHtml(diag.localIp)}</span>`;
    }
    if (!ipInfo && diag?.iceState === 'connected') {
        ipInfo = '<span class="diag-ip dim">已连通</span>';
    } else if (!ipInfo) {
        ipInfo = '<span class="diag-ip dim">等待连接...</span>';
    }

    return `<div class="diag-peer">
        <div class="diag-peer-top">
            <span class="diag-peer-status ${statusCls}">${statusIcon}</span>
            <span class="diag-peer-name">${escapeHtml(name)}</span>
            ${rttInfo}
            ${connInfo}
        </div>
        <div class="diag-peer-info">${ipInfo}</div>
    </div>`;
}

function toggleConnectionPanel() {
    const panel = document.getElementById('connection-panel');
    if (panel) panel.classList.toggle('open');
}

// 更新侧边栏连接质量图标（语音用户旁）
function updateConnectionQualityIcon(peerId) {
    const el = document.getElementById(`conn-quality-${peerId}`);
    if (!el) return;
    const diag = peerDiagData[peerId];
    if (!diag) return;

    let icon, title;
    if (diag.iceState === 'connected') {
        if (diag.connectionType === 'p2p') {
            icon = diag.rtt && parseInt(diag.rtt) < 30 ? '⚡' : '🟢';
            title = 'P2P 直连' + (diag.rtt ? ` ${diag.rtt}ms` : '');
        } else if (diag.connectionType === 'relay') {
            icon = '🔄';
            title = 'TURN 中继' + (diag.rtt ? ` ${diag.rtt}ms` : '');
        } else {
            icon = '🟢';
            title = '已连接';
        }
    } else if (diag.iceState === 'checking') {
        icon = '🟠'; title = '连接中…';
    } else {
        icon = '🔴'; title = '未连接';
    }
    el.textContent = icon;
    el.title = title;
}
