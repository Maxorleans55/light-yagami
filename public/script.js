let currentPairing = null;
let checkInterval = null;

// Request pairing code
async function requestPairing() {
    const countryCode = document.getElementById('countryCode').value;
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    
    if (!phoneNumber) {
        alert('Please enter your phone number');
        return;
    }
    
    // Validate phone number (basic validation)
    const fullNumber = countryCode + phoneNumber;
    if (phoneNumber.length < 7 || phoneNumber.length > 12) {
        alert('Please enter a valid phone number');
        return;
    }
    
    // Show loader
    document.getElementById('btnText').style.display = 'none';
    document.getElementById('btnLoader').style.display = 'inline-block';
    document.querySelector('.btn-primary').disabled = true;
    
    try {
        const response = await fetch('/api/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: fullNumber })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentPairing = data.pairingCode;
            
            // Show waiting state
            document.getElementById('pairingCode').textContent = 'Loading...';
            document.getElementById('phoneCard').classList.add('hidden');
            document.getElementById('pairingCard').classList.remove('hidden');
            
            // Update steps
            document.getElementById('step1').classList.remove('active');
            document.getElementById('step1').classList.add('completed');
            document.getElementById('step2').classList.add('active');
            
            // Start polling for actual code
            pollForActualCode(data.pairingCode);
        } else {
            alert(data.error || 'Failed to generate pairing code');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to connect to server');
    } finally {
        document.getElementById('btnText').style.display = 'inline';
        document.getElementById('btnLoader').style.display = 'none';
        document.querySelector('.btn-primary').disabled = false;
    }
}

// Poll for actual WhatsApp pairing code
let pollInterval = null;

async function pollForActualCode(tempCode) {
    if (pollInterval) clearInterval(pollInterval);
    
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds
    
    pollInterval = setInterval(async () => {
        attempts++;
        
        if (attempts > maxAttempts) {
            clearInterval(pollInterval);
            showError('Timeout waiting for pairing code. Please try again.');
            return;
        }
        
        try {
            const response = await fetch(`/api/actual-code/${tempCode}`);
            const data = await response.json();
            
            if (data.success && data.actualCode) {
                clearInterval(pollInterval);
                
                // Format the actual code (XXXX-XXXX)
                const formattedCode = data.actualCode.replace(/(.{4})/g, '$1-').slice(0, -1);
                document.getElementById('pairingCode').textContent = formattedCode;
                
                // Update status
                document.getElementById('status').innerHTML = '<span class="status-dot"></span><span>Enter this code in WhatsApp</span>';
                
                // Start checking connection status
                startStatusCheck(tempCode);
            } else if (data.status === 'connected') {
                clearInterval(pollInterval);
                showSuccess();
            }
        } catch (error) {
            console.log('Polling...', attempts);
        }
    }, 1000);
}

// Format pairing code with dashes
function formatPairingCode(code) {
    if (!code) return '---';
    // Format as XXXX-XXXX-XXXX
    return code.replace(/(.{4})/g, '$1-').slice(0, -1);
}

// Start checking connection status
function startStatusCheck(pairingCode) {
    if (checkInterval) clearInterval(checkInterval);
    
    checkInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/status/${pairingCode}`);
            const data = await response.json();
            
            if (data.connected) {
                clearInterval(checkInterval);
                showSuccess();
            } else if (data.expired) {
                clearInterval(checkInterval);
                showError('Pairing code expired. Please try again.');
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 2000);
}

// Show success
function showSuccess() {
    document.getElementById('pairingCard').classList.add('hidden');
    document.getElementById('successCard').classList.remove('hidden');
    
    // Update steps
    document.getElementById('step2').classList.remove('active');
    document.getElementById('step2').classList.add('completed');
    document.getElementById('step3').classList.add('active');
    
    // Update status
    const status = document.getElementById('status');
    status.innerHTML = '<span class="status-dot"></span><span>Connected!</span>';
    status.classList.add('success');
}

// Show error
function showError(message) {
    const status = document.getElementById('status');
    status.innerHTML = `<span class="status-dot"></span><span>${message}</span>`;
    status.classList.add('error');
    
    setTimeout(() => {
        document.getElementById('pairingCard').classList.add('hidden');
        document.getElementById('phoneCard').classList.remove('hidden');
        document.getElementById('step1').classList.add('active');
        document.getElementById('step2').classList.remove('active');
    }, 3000);
}

// Cancel pairing
function cancelPairing() {
    if (checkInterval) clearInterval(checkInterval);
    
    document.getElementById('pairingCard').classList.add('hidden');
    document.getElementById('phoneCard').classList.remove('hidden');
    
    // Reset steps
    document.getElementById('step1').classList.add('active');
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
