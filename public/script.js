let currentPairing = null;
let statusInterval = null;
let musicPlaying = false;

// Music control
function toggleMusic() {
    const bgm = document.getElementById('bgm');
    const btn = document.getElementById('musicBtn');
    const label = document.getElementById('musicLabel');

    if (musicPlaying) {
        bgm.pause();
        btn.classList.remove('playing');
        label.textContent = 'Play Music';
        musicPlaying = false;
    } else {
        bgm.play().then(() => {
            btn.classList.add('playing');
            label.textContent = 'Pause Music';
            musicPlaying = true;
        }).catch(e => {
            console.log('Autoplay blocked:', e);
            label.textContent = 'Click to Play';
        });
    }
}

// Try autoplay on load, fallback to first interaction
document.addEventListener('DOMContentLoaded', () => {
    const bgm = document.getElementById('bgm');
    bgm.volume = 0.5;

    bgm.play().then(() => {
        document.getElementById('musicBtn').classList.add('playing');
        document.getElementById('musicLabel').textContent = 'Pause Music';
        musicPlaying = true;
    }).catch(() => {
        const playOnInteraction = () => {
            bgm.play().then(() => {
                document.getElementById('musicBtn').classList.add('playing');
                document.getElementById('musicLabel').textContent = 'Pause Music';
                musicPlaying = true;
            });
            document.removeEventListener('click', playOnInteraction);
        };
        document.addEventListener('click', playOnInteraction);
    });
});

// Tab switching
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
}

// QR Code polling
let qrInterval = null;

async function fetchQR() {
    try {
        const res = await fetch('/api/qr');
        const data = await res.json();
        
        const container = document.getElementById('qrContainer');
        const status = document.getElementById('qrStatus');
        
        if (data.connected) {
            container.innerHTML = '<div style="text-align:center;color:#2ecc71;font-size:18px;font-weight:600;">Bot is Connected!</div>';
            status.innerHTML = '<span class="status-dot" style="background:#2ecc71"></span><span>Device linked successfully</span>';
            if (qrInterval) clearInterval(qrInterval);
            return;
        }
        
        if (data.qr) {
            container.innerHTML = `<img src="${data.qr}" alt="QR Code">`;
            status.innerHTML = '<span class="status-dot"></span><span>Scan with WhatsApp</span>';
        } else {
            container.innerHTML = '<div class="qr-loading"><div class="loader"></div><span>Generating QR code...</span></div>';
        }
    } catch (e) {
        console.log('QR fetch error:', e);
    }
}

// Start QR polling when QR tab is active
function startQRPolling() {
    fetchQR();
    if (qrInterval) clearInterval(qrInterval);
    qrInterval = setInterval(fetchQR, 3000);
}

// Auto-start QR polling
document.addEventListener('DOMContentLoaded', () => {
    startQRPolling();
});

// Request pairing code
async function requestPairing() {
    const countryCode = document.getElementById('countryCode').value;
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    
    if (!phoneNumber) {
        alert('Please enter your phone number');
        return;
    }
    
    const fullNumber = countryCode + phoneNumber;
    if (phoneNumber.length < 7 || phoneNumber.length > 12) {
        alert('Please enter a valid phone number');
        return;
    }
    
    // Show loading state
    document.getElementById('btnText').textContent = 'Generating Code...';
    document.getElementById('btnLoader').style.display = 'inline-block';
    document.querySelector('.btn-primary').disabled = true;
    document.getElementById('pairingCode').textContent = 'Loading...';
    document.getElementById('phoneCard').classList.add('hidden');
    document.getElementById('pairingCard').classList.remove('hidden');
    
    // Update steps
    document.getElementById('step1').classList.remove('active');
    document.getElementById('step1').classList.add('completed');
    document.getElementById('step2').classList.add('active');
    
    try {
        const response = await fetch('/api/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: fullNumber })
        });
        
        const data = await response.json();
        
        if (data.success && data.pairingCode) {
            currentPairing = data.pairingCode;
            
            // Format the code (XXXX-XXXX)
            const formattedCode = data.pairingCode.replace(/(.{4})/g, '$1-').slice(0, -1);
            document.getElementById('pairingCode').textContent = formattedCode;
            
            // Update status
            document.getElementById('status').innerHTML = '<span class="status-dot"></span><span>Enter this code in WhatsApp (within 2 minutes)</span>';
            
            // Start checking connection status using the pairing code
            startStatusCheck(data.pairingCode);
        } else {
            showError(data.error || 'Failed to generate pairing code');
            document.getElementById('pairingCard').classList.add('hidden');
            document.getElementById('phoneCard').classList.remove('hidden');
            document.getElementById('step1').classList.remove('completed');
            document.getElementById('step1').classList.add('active');
            document.getElementById('step2').classList.remove('active');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Failed to connect to server');
        document.getElementById('pairingCard').classList.add('hidden');
        document.getElementById('phoneCard').classList.remove('hidden');
    } finally {
        document.getElementById('btnText').textContent = 'Get Pairing Code';
        document.getElementById('btnLoader').style.display = 'none';
        document.querySelector('.btn-primary').disabled = false;
    }
}

// Check connection status
function startStatusCheck(pairingCode) {
    if (statusInterval) clearInterval(statusInterval);
    
    statusInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/status/${pairingCode}`);
            const data = await response.json();
            
            if (data.connected) {
                clearInterval(statusInterval);
                showSuccess();
            }
        } catch (error) {
            console.log('Status check error:', error);
        }
    }, 2000);
}

// Show success
function showSuccess() {
    document.getElementById('pairingCard').classList.add('hidden');
    document.getElementById('successCard').classList.remove('hidden');
    
    document.getElementById('step2').classList.remove('active');
    document.getElementById('step2').classList.add('completed');
    document.getElementById('step3').classList.add('active');
}

// Show error
function showError(message) {
    const status = document.getElementById('status');
    status.innerHTML = `<span class="status-dot" style="background:#f56565"></span><span>${message}</span>`;
}

// Cancel pairing
function cancelPairing() {
    if (statusInterval) clearInterval(statusInterval);
    
    document.getElementById('pairingCard').classList.add('hidden');
    document.getElementById('phoneCard').classList.remove('hidden');
    
    document.getElementById('step1').classList.add('active');
    document.getElementById('step1').classList.remove('completed');
    document.getElementById('step2').classList.remove('active');
}

// Allow only numbers in phone input
document.getElementById('phoneNumber').addEventListener('input', function(e) {
    this.value = this.value.replace(/[^0-9]/g, '');
});

// Allow Enter key to submit
document.getElementById('phoneNumber').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        requestPairing();
    }
});

// Letter-by-letter text animation
function createLetters(elementId, text) {
    const el = document.getElementById(elementId);
    el.innerHTML = '';
    text.split('').forEach((char, i) => {
        const span = document.createElement('span');
        span.className = 'letter';
        span.textContent = char === ' ' ? '\u00A0' : char;
        span.style.animationDelay = `${i * 0.1}s`;
        el.appendChild(span);
    });
}

function hideLetters(elementId, text) {
    const el = document.getElementById(elementId);
    const letters = el.querySelectorAll('.letter');
    letters.forEach((span, i) => {
        span.classList.add('hide');
        span.style.animationDelay = `${i * 0.05}s`;
    });
}

function loopTextAnimation() {
    createLetters('textLight', 'LIGHT');
    createLetters('textYagami', 'YAGAMI');

    setTimeout(() => {
        hideLetters('textLight', 'LIGHT');
        hideLetters('textYagami', 'YAGAMI');
    }, 3000);

    setTimeout(loopTextAnimation, 4500);
}

loopTextAnimation();
