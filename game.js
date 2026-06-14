const logDiv = document.getElementById('debug-log');

function debugLog(text, isError = false) {
    const time = new Date().toLocaleTimeString();
    const logLine = `[${time}] ${text}`;
    const color = isError ? 'color: #ff4d4d;' : '';
    logDiv.innerHTML += `<div style="${color}">${logLine}</div>`;
    logDiv.scrollTop = logDiv.scrollHeight;
    console.log(text);
}

function copyDebugLog() {
    const range = document.createRange();
    range.selectNode(logDiv);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    try {
        document.execCommand('copy');
        alert("Лог отладки скопирован в буфер!");
    } catch(e) {
        alert("Ошибка копирования. Выделите лог пальцем.");
    }
    window.getSelection().removeAllRanges();
}

window.onerror = function(message, source, lineno, colno, error) {
    debugLog(`КРИТИЧЕСКАЯ ОШИБКА: ${message} (Строка: ${lineno})`, true);
    return false;
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let myPlayer = { x: 50, y: 200, color: '#007bff', size: 30 };
let enemyPlayer = { x: 320, y: 200, color: '#dc3545', size: 30, active: false };

let pc = null;
let dataChannel = null;

// Безопасный запуск WebRTC
try {
    debugLog("Проверка поддержки WebRTC...");
    if (!window.RTCPeerConnection) {
        throw new Error("WebRTC НЕ поддерживается этим устройством!");
    }
    
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:://google.com' },
            { urls: 'stun:://mozilla.com' }
        ]
    });
    debugLog("Объект RTCPeerConnection успешно создан.");
} catch (e) {
    debugLog("Основной STUN-сервер отклонен. Переход в автономный режим...", true);
    try {
        pc = new RTCPeerConnection({ iceServers: [] });
        debugLog("Автономный RTCPeerConnection успешно запущен.");
    } catch(fallbackError) {
        debugLog("Критический сбой WebRTC: " + fallbackError.message, true);
    }
}

function pack(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unpack(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
}

const urlParams = new URLSearchParams(window.location.search);
const incomingOffer = urlParams.get('offer');

if (incomingOffer) {
    debugLog("Найден оффер в ссылке. Запуск КЛИЕНТА...");
    document.getElementById('setup-panel').classList.add('hidden');
    setTimeout(() => startAsClient(incomingOffer), 500);
}

async function startAsHost() {
    debugLog("Нажата кнопка Хоста.");
    if (!pc) {
        debugLog("Ошибка: RTCPeerConnection равен null!", true);
        return;
    }
    document.getElementById('setup-panel').classList.add('hidden');
    
    try {
        dataChannel = pc.createDataChannel("game-channel");
        setupDataChannel();

        const offer = await pc.createOffer();
        debugLog("Локальный оффер создан.");
        await pc.setLocalDescription(offer);
        debugLog("Сбор сетевых ICE-адресов...");
    } catch (err) {
        debugLog("Ошибка создания оффера: " + err.message, true);
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            debugLog("Найден ICE-адрес устройства.");
        }
        if (event.candidate === null) {
            debugLog("Сбор ICE окончен! Вывод ссылки...");
            try {
                const compressedOffer = pack(pc.localDescription);
                const inviteLink = `${window.location.origin}${window.location.pathname}?offer=${compressedOffer}`;
                
                document.getElementById('exchange-panel').classList.remove('hidden');
                document.getElementById('output-link-text').value = inviteLink;
                document.getElementById('host-input-container').classList.remove('hidden');
                debugLog("ССЫЛКА УСПЕШНО СГЕНЕРИРОВАНА НА ЭКРАНЕ!");
            } catch(packErr) {
                debugLog("Ошибка упаковки: " + packErr.message, true);
            }
        }
    };
}

function copyGeneratedLink() {
    const textArea = document.getElementById('output-link-text');
    textArea.select();
    textArea.setSelectionRange(0, 99999); 
    try {
        document.execCommand('copy'); 
        document.getElementById('manual-copy-btn').innerText = "📋 Скопировано!";
    } catch (err) {
        alert("Скопируйте текст из поля вручную.");
    }
}

function connectToClient() {
    const inputVal = document.getElementById('client-link-input').value.trim();
    if (!inputVal) return alert("Вставьте текст!");
    
    try {
        let answerStr = inputVal;
        if (inputVal.includes('answer=')) {
            const url = new URL(inputVal);
            answerStr = url.searchParams.get('answer');
        }
        const answer = unpack(answerStr);
        debugLog("Ответ принят. Подключение...");
        pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch(e) {
        debugLog("Ошибка разбора ответа: " + e.message, true);
    }
}

async function startAsClient(offerStr) {
    if (!pc) return debugLog("Ошибка: pc=null", true);
    
    pc.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel();
    };

    myPlayer.color = '#dc3545';
    enemyPlayer.color = '#007bff';

    try {
        const offer = unpack(offerStr);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        debugLog("Локальный ответ клиента сгенерирован.");
    } catch (err) {
        debugLog("Ошибка клиента: " + err.message, true);
    }

    pc.onicecandidate = (event) => {
        if (event.candidate === null) {
            debugLog("Сбор адресов клиента завершен.");
            const compressedAnswer = pack(pc.localDescription);
            const responseLink = `${window.location.origin}${window.location.pathname}?answer=${compressedAnswer}`;
            
            document.getElementById('exchange-panel').classList.remove('hidden');
            document.getElementById('output-link-text').value = responseLink;
            debugLog("ОТВЕТНАЯ ССЫЛКА НА ЭКРАНЕ!");
        }
    };
}

function setupDataChannel() {
    dataChannel.onopen = () => {
        debugLog("P2P СВЯЗЬ УСТАНОВЛЕНА НАПРЯМУЮ!");
        document.getElementById('exchange-panel').classList.add('hidden');
        enemyPlayer.active = true;
        sendMyPosition();
    };
    dataChannel.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'MOVE') {
                enemyPlayer.x = data.x;
                enemyPlayer.y = data.y;
            }
        } catch(e){}
    };
    dataChannel.onclose = () => {
        debugLog("Соединение потеряно.", true);
        enemyPlayer.active = false;
    };
}

function sendMyPosition() {
    if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(JSON.stringify({ type: 'MOVE', x: myPlayer.x, y: myPlayer.y }));
    }
}

function moveHandler(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    myPlayer.x = ((clientX - rect.left) / rect.width) * canvas.width - myPlayer.size / 2;
    myPlayer.y = ((clientY - rect.top) / rect.height) * canvas.height - myPlayer.size / 2;
    sendMyPosition();
}

canvas.addEventListener('click', (e) => moveHandler(e.clientX, e.clientY));
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0]; // Исправлено для корректного тача
    moveHandler(touch.clientX, touch.clientY);
}, { passive: false });

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = myPlayer.color;
    ctx.fillRect(myPlayer.x, myPlayer.y, myPlayer.size, myPlayer.size);
    if (enemyPlayer.active) {
        ctx.fillStyle = enemyPlayer.color;
        ctx.fillRect(enemyPlayer.x, enemyPlayer.y, enemyPlayer.size, enemyPlayer.size);
    }
    requestAnimationFrame(gameLoop);
}
gameLoop();
