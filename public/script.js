let currentPairing = null;
let statusInterval = null;

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
