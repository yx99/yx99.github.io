// ==========================================
// ui.js — DOM 更新与 UI 状态管理
// ==========================================
let myName = '';
window._myName = '';

function initUI() {
    myName = storageGet(CONFIG.STORAGE_KEYS.USERNAME, 'user_' + Math.floor(Math.random() * 1000));
    window._myName = myName;
    storageSet(CONFIG.STORAGE_KEYS.USERNAME, myName);
}

// ==========================================
// 身份展示
// ==========================================
function updateMyIdentityUI() {
    const nameEl = document.getElementById('my-name-display');
    const avatarEl = document.getElementById('my-avatar-icon');
    const idEl = document.getElementById('my-id-display');
    const roomIdEl = document.getElementById('top-room-id');

    if (nameEl) nameEl.innerText = myName;
    if (avatarEl) avatarEl.innerText = getInitial(myName);
    if (idEl && myFullId) idEl.innerText = "ID: " + formatShortId(myFullId);
    if (roomIdEl) roomIdEl.innerText = "房间 ID: " + formatShortId(currentRoomId);
}

function changeName() {
    const newName = prompt("请输入新的昵称：", myName);
    if (newName && newName.trim() !== '') {
        myName = newName.trim();
        window._myName = myName;
        storageSet(CONFIG.STORAGE_KEYS.USERNAME, myName);
        updateMyIdentityUI();
        const myVoiceName = document.getElementById('my-voice-name');
        if (myVoiceName) myVoiceName.innerText = myName;
        broadcastData({ type: 'system', text: `已改名为 ${myName}`, user: myName });
    }
}

function resetConfig() {
    if (confirm("确定要修改服务器密码吗？\n这将清除当前保存的配置并重新启动应用。")) {
        storageRemove(CONFIG.STORAGE_KEYS.TURN_PASSWORD);
        window.location.reload();
    }
}

function copyMyId() {
    copyToClipboard(myFullId).then(ok => {
        const el = document.getElementById('my-id-display');
        if (!el || !ok) return;
        flashElement(el, "✅ 复制成功", "var(--success)");
    });
}

function copyRoomId() {
    copyToClipboard(currentRoomId).then(ok => {
        const el = document.getElementById('top-room-id');
        if (!el || !ok) return;
        flashElement(el, "✅ 复制成功", "var(--success)");
    });
}

function flashElement(el, flashText, flashColor) {
    const origin = el.innerText;
    el.innerText = flashText;
    el.style.color = flashColor;
    setTimeout(() => {
        el.innerText = origin;
        el.style.color = "";
    }, 2000);
}

// ==========================================
// 顶栏状态
// ==========================================
function updateTopBarStatus() {
    const count = Object.keys(meshPeers).length;
    const connectArea = document.getElementById('connect-area');
    const roomStatusArea = document.getElementById('room-status-area');
    const nodeCount = document.getElementById('mesh-node-count');

    if (count > 0) {
        if (connectArea) connectArea.style.display = 'none';
        if (roomStatusArea) roomStatusArea.style.display = 'flex';
        if (nodeCount) nodeCount.innerText = count + 1;

        const disconnectBtn = document.getElementById('disconnect-btn');
        if (disconnectBtn) {
            disconnectBtn.innerText = amIHost() ? "解散房间" : "离开房间";
            disconnectBtn.className = amIHost() ? "btn-danger" : "btn-outline";
        }
    } else {
        if (connectArea) connectArea.style.display = 'flex';
        if (roomStatusArea) roomStatusArea.style.display = 'none';
    }
}

// ==========================================
// 个人音量弹窗
// ==========================================
function showPersonalVolumePopup(event, peerId, peerName) {
    event.stopPropagation();
    const popup = document.getElementById('personal-vol-popup');
    const nameEl = document.getElementById('personal-vol-name');
    const slider = document.getElementById('personal-vol-slider');

    if (nameEl) nameEl.innerText = `调节 ${peerName} 的音量`;
    if (slider) {
        slider.value = userVolumes[peerId] !== undefined ? userVolumes[peerId] : 1.0;
        slider.oninput = (e) => {
            userVolumes[peerId] = parseFloat(e.target.value);
            applyAllVolumes();
        };
    }
    if (popup) {
        popup.style.left = (event.pageX + 15) + 'px';
        popup.style.top = (event.pageY - 10) + 'px';
        popup.style.display = 'flex';
        popup.setAttribute('data-target', peerId);
    }
}

// 点击外部关闭弹窗
document.addEventListener('click', (e) => {
    const popup = document.getElementById('personal-vol-popup');
    if (popup && !popup.contains(e.target)) popup.style.display = 'none';
});

// ==========================================
// 侧边栏移动端折叠
// ==========================================
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

// ==========================================
// Toast 通知系统
// ==========================================
function showToast(message, type) {
    type = type || 'info';
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) container.remove();
    }, CONFIG.TOAST_DURATION);
}

// ==========================================
// 键盘快捷键
// ==========================================
document.addEventListener('keydown', (e) => {
    // Ctrl+M 开关麦克风
    if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        if (typeof toggleMic === 'function') toggleMic();
    }
    // Ctrl+D 开关扬声器
    if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        if (typeof toggleSpeaker === 'function') toggleSpeaker();
    }
    // Ctrl+B 切换侧边栏
    if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
    }
    // Ctrl+I 切换连接诊断面板
    if (e.ctrlKey && e.key === 'i') {
        e.preventDefault();
        if (typeof toggleConnectionPanel === 'function') toggleConnectionPanel();
    }
});
