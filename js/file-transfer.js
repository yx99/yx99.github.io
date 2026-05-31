// ==========================================
// file-transfer.js — 文件传输 (基于 DataConnection)
// ==========================================

const CHUNK_SIZE = 10240; // 10KB raw per chunk
let pendingFiles = {};     // { fileId: { name, size, mime, totalChunks, chunks[], fromPeer, conn, checksums[] } }
let sendingFiles = {};     // { fileId: { name, size, conn, cancelled } }

// ==========================================
// 发送方: 拖入文件 → 确认 → 发送
// ==========================================
function initFileDropZone() {
    const chatArea = document.querySelector('.chat-area');
    if (!chatArea) return;

    chatArea.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        chatArea.classList.add('drag-over');
    });
    chatArea.addEventListener('dragleave', e => {
        e.preventDefault();
        e.stopPropagation();
        chatArea.classList.remove('drag-over');
    });
    chatArea.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        chatArea.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            for (const f of files) promptSendFile(f);
        }
    });
}

function selectFileToSend() {
    const peerIds = Object.keys(meshPeers);
    if (peerIds.length === 0) {
        alert('没有可发送的对端，请先建立连接。');
        return;
    }
    const input = document.getElementById('file-input');
    if (input) input.click();
}

function onFileInputChange(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
        for (const f of files) promptSendFile(f);
    }
    // 清除以便重复选择同名文件
    e.target.value = '';
}

function promptSendFile(file) {
    const peerIds = Object.keys(meshPeers);
    if (peerIds.length === 0) {
        alert('没有可发送的对端，请先建立连接。');
        return;
    }
    if (!confirm(`发送文件 "${file.name}" (${formatSize(file.size)})？`)) return;

    if (peerIds.length === 1) {
        sendFileToPeer(peerIds[0], file);
    } else {
        // 多个对端时让用户选择
        const names = peerIds.map(pid => `${getPeerName(pid)} (${formatShortId(pid, 8)})`).join('\n');
        const target = prompt(`发送给哪个对端？输入序号:\n${peerIds.map((pid, i) => `${i + 1}. ${getPeerName(pid)}`).join('\n')}`);
        if (!target) return;
        const idx = parseInt(target) - 1;
        if (idx >= 0 && idx < peerIds.length) {
            sendFileToPeer(peerIds[idx], file);
        }
    }
}

async function sendFileToPeer(peerId, file) {
    const conn = meshPeers[peerId]?.dataConn;
    if (!conn || !conn.open) {
        alert('该对端的 DataConnection 不可用');
        return;
    }

    const fileId = randomId(12);
    const buffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
    const hash = await computeHash(buffer);

    sendingFiles[fileId] = { name: file.name, size: file.size, conn, cancelled: false };

    // 发送 offer
    conn.send({
        type: 'file-offer', id: fileId,
        name: file.name, size: file.size, mime: file.type || 'application/octet-stream',
        totalChunks: totalChunks
    });

    appendFileMsg('send-start', file.name, formatSize(file.size), fileId, peerId);

    // 等待接收方确认
    const acceptHandler = (data) => {
        if (data.type === 'file-accept' && data.id === fileId) {
            conn.off('data', acceptHandler);
            startSendingChunks(fileId, peerId, buffer, totalChunks, hash, conn);
        } else if (data.type === 'file-decline' && data.id === fileId) {
            conn.off('data', acceptHandler);
            appendFileMsg('send-declined', file.name, '', fileId, peerId);
            delete sendingFiles[fileId];
        }
    };
    conn.on('data', acceptHandler);

    // 30s 超时
    setTimeout(() => {
        if (sendingFiles[fileId]) {
            conn.off('data', acceptHandler);
            appendFileMsg('send-timeout', file.name, '', fileId, peerId);
            delete sendingFiles[fileId];
        }
    }, 30000);
}

async function startSendingChunks(fileId, peerId, buffer, totalChunks, fullHash, conn) {
    if (!conn.open) { delete sendingFiles[fileId]; return; }

    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < totalChunks; i++) {
        if (sendingFiles[fileId]?.cancelled) { delete sendingFiles[fileId]; return; }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, bytes.byteLength);
        const chunk = bytes.slice(start, end);
        // 转 base64
        let binary = '';
        for (let j = 0; j < chunk.byteLength; j++) {
            binary += String.fromCharCode(chunk[j]);
        }
        const b64 = btoa(binary);

        conn.send({ type: 'file-chunk', id: fileId, index: i, data: b64 });

        // 更新进度
        const pct = Math.round(((i + 1) / totalChunks) * 100);
        updateFileProgress(fileId, pct);

        // 限速: 每 5 块暂停一下防止 DataChannel 拥塞
        if (i % 5 === 4) {
            await sleep(50);
        }
    }

    // 发送完成通知
    conn.send({ type: 'file-done', id: fileId, checksum: fullHash });

    // 等待 ack
    const doneHandler = (data) => {
        if (data.type === 'file-ack' && data.id === fileId) {
            conn.off('data', doneHandler);
            appendFileMsg('send-done', sendingFiles[fileId]?.name || '文件', '', fileId, peerId);
            delete sendingFiles[fileId];
        }
    };
    conn.on('data', doneHandler);
    setTimeout(() => {
        conn.off('data', doneHandler);
        if (sendingFiles[fileId]) {
            appendFileMsg('send-done', sendingFiles[fileId].name, '', fileId, peerId);
            delete sendingFiles[fileId];
        }
    }, 15000);
}

// ==========================================
// 接收方: offer → 确认 → 收块 → 重组 → 校验 → 下载
// ==========================================
function handleFileOffer(data, conn) {
    if (!data.id || !data.name) return;

    pendingFiles[data.id] = {
        name: data.name, size: data.size, mime: data.mime || 'application/octet-stream',
        totalChunks: data.totalChunks, chunks: [], fromPeer: conn.peer, conn: conn
    };

    const totalSize = formatSize(data.size);
    appendFileReceiveMsg(data.id, data.name, totalSize, conn.peer);
}

function acceptFile(fileId) {
    const pf = pendingFiles[fileId];
    if (!pf) return;
    pf.conn.send({ type: 'file-accept', id: fileId });
    updateFileReceiveStatus(fileId, 'receiving', '接收中...');

    // 设置接收 handler
    const recvHandler = (data) => {
        if (data.type === 'file-chunk' && data.id === fileId) {
            pf.chunks[data.index] = data.data;
            const pct = Math.round((Object.keys(pf.chunks).length / pf.totalChunks) * 100);
            updateFileReceiveStatus(fileId, 'receiving', `${pct}%`);
        } else if (data.type === 'file-done' && data.id === fileId) {
            pf.conn.off('data', recvHandler);
            assembleAndDownload(fileId, data.checksum);
        }
    };
    pf.conn.on('data', recvHandler);
}

function declineFile(fileId) {
    const pf = pendingFiles[fileId];
    if (!pf) return;
    pf.conn.send({ type: 'file-decline', id: fileId });
    updateFileReceiveStatus(fileId, 'declined', '已拒绝');
    delete pendingFiles[fileId];
}

async function assembleAndDownload(fileId, senderChecksum) {
    const pf = pendingFiles[fileId];
    if (!pf) return;

    // 检查是否收集了所有块
    if (Object.keys(pf.chunks).length !== pf.totalChunks) {
        updateFileReceiveStatus(fileId, 'error', '文件不完整');
        delete pendingFiles[fileId];
        return;
    }

    try {
        // 重组: base64 解码每个块
        const totalSize = pf.size;
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (let i = 0; i < pf.totalChunks; i++) {
            const b64 = pf.chunks[i];
            if (!b64) throw new Error(`缺少块 ${i}`);
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) {
                bytes[j] = binary.charCodeAt(j);
            }
            result.set(bytes, offset);
            offset += bytes.byteLength;
        }

        // 校验
        const blob = new Blob([result], { type: pf.mime });
        const localHash = await computeHash(await blob.arrayBuffer());
        if (senderChecksum && localHash !== senderChecksum) {
            updateFileReceiveStatus(fileId, 'error', '校验失败，文件损坏');
            delete pendingFiles[fileId];
            return;
        }

        // 发送 ack
        pf.conn.send({ type: 'file-ack', id: fileId });

        // 触发下载
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = pf.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        updateFileReceiveStatus(fileId, 'done', '已下载');
        showToast(`"${pf.name}" 接收完成`, 'success');
    } catch (e) {
        debugLog('file', '文件重组失败:', e);
        updateFileReceiveStatus(fileId, 'error', '重组失败');
    }
    delete pendingFiles[fileId];
}

// ==========================================
// 工具函数
// ==========================================
async function computeHash(buffer) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ==========================================
// 聊天区文件消息渲染
// ==========================================
function appendFileMsg(stage, name, size, fileId, peerId) {
    const peerName = getPeerName(peerId);
    let html = '';
    switch (stage) {
        case 'send-start':
            html = `<div class="msg-file" id="file-msg-${fileId}">
                <span class="file-icon">📄</span>
                <span class="file-info"><b>${escapeHtml(name)}</b> ${size} → ${escapeHtml(peerName)}</span>
                <span class="file-status" id="file-status-${fileId}">等待确认...</span>
            </div>`;
            break;
        case 'send-declined':
            updateFileStatus(fileId, '对方拒绝接收', 'declined');
            return;
        case 'send-timeout':
            updateFileStatus(fileId, '超时无应答', 'declined');
            return;
        case 'send-done':
            updateFileStatus(fileId, '✅ 发送完成', 'done');
            return;
    }
    if (html) appendToChat(html);
}

function appendFileReceiveMsg(fileId, name, size, fromPeer) {
    const peerName = getPeerName(fromPeer);
    const html = `<div class="msg-file receive" id="file-msg-${fileId}">
        <span class="file-icon">📄</span>
        <span class="file-info"><b>${escapeHtml(name)}</b> ${size} ← ${escapeHtml(peerName)}</span>
        <span class="file-actions" id="file-actions-${fileId}">
            <button class="btn-mini accept" onclick="acceptFile('${fileId}')">接收</button>
            <button class="btn-mini decline" onclick="declineFile('${fileId}')">拒绝</button>
        </span>
        <span class="file-status" id="file-status-${fileId}" style="display:none;"></span>
    </div>`;
    appendToChat(html);
}

function updateFileProgress(fileId, pct) {
    updateFileStatus(fileId, `发送中 ${pct}%`, 'sending');
}

function updateFileReceiveStatus(fileId, stage, text) {
    const actions = document.getElementById(`file-actions-${fileId}`);
    if (actions) actions.style.display = 'none';
    updateFileStatus(fileId, text, stage);
}

function updateFileStatus(fileId, text, cls) {
    const el = document.getElementById(`file-status-${fileId}`);
    if (el) {
        el.textContent = text;
        el.style.display = 'inline';
        el.className = 'file-status ' + cls;
    }
}

function appendToChat(html) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;
    const div = document.createElement('div');
    div.innerHTML = html;
    chatBox.appendChild(div.firstElementChild);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 初始化拖拽区
setTimeout(initFileDropZone, 1000);
