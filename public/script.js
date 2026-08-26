let currentPairing = null;
let statusInterval = null;
let statsInterval = null;

// Toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    setTimeout(() => toast.className = 'toast hidden', 3000);
}

// Format uptime
function formatUptime(seconds) {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

// Fetch bot status
async function fetchBotStatus() {
    try {
        const res = await fetch('/api/bot-status');
        const data = await res.json();

        const pulse = document.getElementById('pulseDot');
        const status = document.getElementById('botStatus');

        if (data.connected) {
            pulse.classList.add('online');
            status.textContent = 'Bot Online';
        } else if (data.online) {
            pulse.classList.remove('online');
            status.textContent = 'Connecting...';
        } else {
            pulse.classList.remove('online');
            status.textContent = 'Bot Offline';
        }

        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('memory').textContent = `${data.memory}MB`;
        document.getElementById('sessionCount').textContent = data.activeSessions;
    } catch (e) {
        document.getElementById('pulseDot').classList.remove('online');
        document.getElementById('botStatus').textContent = 'Server Offline';
    }
}

// Fetch stats
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        document.getElementById('userCount').textContent = data.totalUsers;
        document.getElementById('groupCount').textContent = data.totalGroups;
    } catch (e) {
        console.log('Stats error:', e);
    }
}

// Fetch commands
async function fetchCommands() {
    try {
        const res = await fetch('/api/commands');
        const data = await res.json();
        const list = document.getElementById('commandsList');
        
        list.innerHTML = data.commands.map(cmd => `
            <div class="command-item" onclick="copyCommand('${cmd.name}')">
                <div class="command-icon">${cmd.icon}</div>
                <div class="command-info">
                    <div class="command-name">!${cmd.name}</div>
                    <div class="command-desc">${cmd.desc}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('commandsList').innerHTML = `
            <div class="loading-state">
                <span>Failed to load commands</span>
            </div>
        `;
    }
}

// Copy command to clipboard
function copyCommand(name) {
    navigator.clipboard.writeText(`!${name}`);
    showToast(`Copied: !${name}`);
}

// Tab switching
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');

    if (tab === 'commands') fetchCommands();
}

// Request pairing code
async function requestPairing() {
    const countryCode = document.getElementById('countryCode').value;
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    
    if (!phoneNumber) {
        showToast('Please enter your phone number', 'error');
        return;
    }
    
    const fullNumber = countryCode + phoneNumber;
    if (phoneNumber.length < 7 || phoneNumber.length > 12) {
        showToast('Please enter a valid phone number', 'error');
        return;
    }
    
    document.getElementById('btnText').textContent = 'Generating Code...';
    document.getElementById('btnLoader').style.display = 'inline-block';
    document.querySelector('.btn-primary').disabled = true;
    document.getElementById('pairingCode').textContent = '...';
    document.getElementById('phoneCard').classList.add('hidden');
    document.getElementById('pairingCard').classList.remove('hidden');
    
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
            const formattedCode = data.pairingCode.replace(/(.{4})/g, '$1-').slice(0, -1);
            document.getElementById('pairingCode').textContent = formattedCode;
            document.getElementById('status').innerHTML = '<span class="status-dot"></span><span>Enter this code in WhatsApp (within 2 minutes)</span>';
            startStatusCheck(data.pairingCode);
            showToast('Pairing code generated!');
        } else {
            showError(data.error || 'Failed to generate pairing code');
            resetToPhoneCard();
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Failed to connect to server');
        resetToPhoneCard();
    } finally {
        document.getElementById('btnText').textContent = 'Get Pairing Code';
        document.getElementById('btnLoader').style.display = 'none';
        document.querySelector('.btn-primary').disabled = false;
    }
}

function resetToPhoneCard() {
    document.getElementById('pairingCard').classList.add('hidden');
    document.getElementById('phoneCard').classList.remove('hidden');
    document.getElementById('step1').classList.remove('completed');
    document.getElementById('step1').classList.add('active');
    document.getElementById('step2').classList.remove('active');
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
                showToast('Device connected successfully!');
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

    fetchBotStatus();
    fetchStats();
}

// Show error
function showError(message) {
    const status = document.getElementById('status');
    status.innerHTML = `<span class="status-dot" style="background:#f56565"></span><span>${message}</span>`;
    showToast(message, 'error');
}

// Cancel pairing
function cancelPairing() {
    if (statusInterval) clearInterval(statusInterval);
    resetToPhoneCard();
}

// Phone input validation
document.getElementById('phoneNumber').addEventListener('input', function(e) {
    this.value = this.value.replace(/[^0-9]/g, '');
});

document.getElementById('phoneNumber').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') requestPairing();
});

// Initial load
fetchBotStatus();
fetchStats();
fetchCommands();

// Auto-refresh every 10 seconds
statsInterval = setInterval(() => {
    fetchBotStatus();
    fetchStats();
}, 10000);
