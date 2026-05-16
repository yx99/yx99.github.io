// ==========================================
// chat.js — 聊天消息收发
// ==========================================
function appendChat(type, user, text) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;

    const msgBlock = document.createElement('div');
    msgBlock.className = 'msg-block';
    const t = timeStr();

    if (type === 'system') {
        msgBlock.className = 'msg-system';
        msgBlock.innerHTML = `➡️ <span style="font-weight:bold;">${escapeHtml(user)}</span>: ${escapeHtml(text)}`;
    } else {
        const initial = getInitial(user);
        const color = stringToColor(user);
        msgBlock.innerHTML = `
            <div class="msg-avatar" style="background:${color};">${initial}</div>
            <div class="msg-content">
                <div class="msg-header">
                    <span class="msg-author">${escapeHtml(user)}</span>
                    <span class="msg-time">${t}</span>
                </div>
                <div class="msg-text">${escapeHtml(text)}</div>
            </div>`;
    }

    chatBox.appendChild(msgBlock);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function handleChatEnter(e) {
    if (e.key === 'Enter') sendChatMessage();
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    appendChat('user', window._myName || '我', text);
    broadcastData({ type: 'chat', user: window._myName || '我', text });
    input.value = '';
}
