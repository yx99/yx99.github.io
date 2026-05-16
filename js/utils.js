// ==========================================
// utils.js — 工具函数
// ==========================================

// 剪贴板复制
function copyToClipboard(text) {
    if (!text) return false;
    return navigator.clipboard.writeText(text)
        .then(() => true)
        .catch(() => false);
}

// 格式化 ID 为短显示
function formatShortId(id, len) {
    len = len || 6;
    if (!id) return '...';
    return id.length > len ? id.substring(0, len) + '...' : id;
}

// 获取名字的首字符 (用于头像)
function getInitial(name) {
    return (name || '?').charAt(0).toUpperCase();
}

// 随机 ID
function randomId(len) {
    len = len || 4;
    return Math.random().toString(36).substring(2, 2 + len);
}

// 安全的 localStorage 读/写
function storageGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; }
    catch (e) { return fallback; }
}

function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
}

function storageRemove(key) {
    try { localStorage.removeItem(key); return true; }
    catch (e) { return false; }
}

// 节流函数
function throttle(fn, ms) {
    let last = 0;
    return function (...args) {
        const now = Date.now();
        if (now - last >= ms) { last = now; fn.apply(this, args); }
    };
}

// 防抖函数
function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

// 获取当前时间字符串
function timeStr() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 转义 HTML 防 XSS
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 调试日志
function debugLog(tag, ...args) {
    console.log(`[${tag}]`, ...args);
}
