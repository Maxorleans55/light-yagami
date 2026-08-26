const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    proto,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const express = require('express');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment-timezone');
const axios = require('axios');
require('dotenv').config();

// ============================================
// CONFIGURATION
// ============================================
const config = {
    botName: process.env.BOT_NAME || 'Light Yagami',
    botPrefix: process.env.BOT_PREFIX || '!',
    ownerNumber: process.env.BOT_OWNER_NUMBER || '',
    ownerName: process.env.BOT_OWNER_NAME || 'Owner',
    sessionId: process.env.SESSION_ID || '',
    googleApiKey: process.env.GOOGLE_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    enableAutoReply: process.env.ENABLE_AUTO_REPLY === 'true',
    enableAiChat: process.env.ENABLE_AI_CHAT === 'true',
    enableGroupControl: process.env.ENABLE_GROUP_CONTROL === 'true',
    port: parseInt(process.env.PORT) || 3000,
    stickerPackName: process.env.STICKER_PACK_NAME || 'Light Yagami',
    stickerPackAuthor: process.env.STICKER_PACK_AUTHOR || 'Bot'
};

// ============================================
// AI CLIENTS
// ============================================
let genAI = null;
let openai = null;

if (config.googleApiKey) {
    genAI = new GoogleGenerativeAI(config.googleApiKey);
}

if (config.openaiApiKey) {
    openai = new OpenAI({ apiKey: config.openaiApiKey });
}

// ============================================
// DATABASE
// ============================================
const dbPath = path.join(__dirname, 'database.json');

function loadDB() {
    try {
        if (fs.existsSync(dbPath)) {
            return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        }
    } catch (e) {}
    return { users: {}, groups: {}, settings: { autoWatchStatus: false, autoLikeStatus: false } };
}

function saveDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function getUserSettings(db, userId) {
    if (!db.users[userId]) {
        db.users[userId] = {
            autoWatchStatus: false,
            autoLikeStatus: false,
            joinedAt: Date.now()
        };
    }
    return db.users[userId];
}

// ============================================
// VIEW ONCE STORAGE
// ============================================
const viewOnceStorage = new Map(); // chatId -> { message, mediaType, timestamp }
const VIEW_ONCE_DIR = path.join(__dirname, 'view_once_media');

// Create directory if not exists
if (!fs.existsSync(VIEW_ONCE_DIR)) {
    fs.mkdirSync(VIEW_ONCE_DIR, { recursive: true });
}

// ============================================
// EXPRESS SERVER (for keep-alive on hosting)
// ============================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store pairing states
const pairingStates = new Map();
const activeSessions = new Map();
let mainSock = null;
let mainSaveCreds = null;

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => res.json({ status: 'online', bot: config.botName }));

// Request pairing code - uses main socket, no separate socket
app.post('/api/pair', async (req, res) => {
    try {
        if (!mainSock) {
            return res.json({ success: false, error: 'Bot not connected yet. Wait for QR scan or try again.' });
        }
        
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.json({ success: false, error: 'Phone number required' });
        }
        
        // Clean phone number - remove all non-digits
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        
        // Validate phone number format
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            return res.json({ success: false, error: 'Invalid phone number format' });
        }
        
        // Check if main bot is registered (has auth)
        if (mainSock.authState?.creds?.registered) {
            console.log(`[Pairing] Bot is already registered. Pairing code can only be used to link NEW devices.`);
            console.log(`[Pairing] This bot is already connected. Other users cannot pair - the owner's session is active.`);
        }
        
        console.log(`[Pairing] Requesting pairing code for: ${cleanNumber}`);
        
        // Request pairing code directly from main socket
        // The fixed Baileys handles browser normalization internally
        const code = await mainSock.requestPairingCode(cleanNumber);
        console.log(`[Pairing] Pairing code generated: ${code}`);
        
        // Store pairing state
        const tempCode = generatePairingCode();
        pairingStates.set(tempCode, {
            phoneNumber: cleanNumber,
            status: 'pending',
            createdAt: Date.now(),
            actualCode: code
        });
        
        // Return the actual pairing code
        res.json({ success: true, pairingCode: code });
    } catch (error) {
        console.error('[Pairing] Error:', error.message || error);
        res.json({ success: false, error: error.message || 'Failed to generate pairing code' });
    }
});

// Check pairing status
app.get('/api/status/:code', (req, res) => {
    const code = req.params.code;
    
    // Check by temp code, active session, or actual pairing code
    let state = pairingStates.get(code);
    let activeSession = activeSessions.get(code);
    
    if (!state && !activeSession) {
        // Search by actual pairing code
        for (const [tempCode, s] of pairingStates.entries()) {
            if (s.actualCode === code) {
                state = s;
                activeSession = activeSessions.get(tempCode);
                break;
            }
        }
    }
    
    if (!state && !activeSession) {
        return res.json({ connected: false, expired: true });
    }
    
    // Check if expired (5 minutes)
    if (state && Date.now() - state.createdAt > 5 * 60 * 1000) {
        pairingStates.delete(code);
        return res.json({ connected: false, expired: true });
    }
    
    const isConnected = (state && state.status === 'connected') || activeSession;
    
    res.json({ 
        connected: isConnected,
        expired: false 
    });
});

// Generate pairing code
function generatePairingCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Cleanup old pairing states every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, state] of pairingStates.entries()) {
        if (now - state.createdAt > 5 * 60 * 1000) {
            pairingStates.delete(code);
            activeSessions.delete(code);
        }
    }
}, 5 * 60 * 1000);


app.listen(config.port, '0.0.0.0', () => console.log(`Server running on port ${config.port}`));

// ============================================
// UTILITY FUNCTIONS
// ============================================
function getTimestamp() {
    return moment().tz('Africa/Accra').format('YYYY-MM-DD HH:mm:ss');
}

function formatNumber(num) {
    return num.replace(/[^0-9]/g, '');
}

function isOwner(jid) {
    const number = formatNumber(jid.replace(/@s.whatsapp.net/, ''));
    return number === formatNumber(config.ownerNumber);
}

function getContentType(msg) {
    if (msg.message?.conversation) return 'text';
    if (msg.message?.extendedTextMessage) return 'extendedText';
    if (msg.message?.imageMessage) return 'image';
    if (msg.message?.videoMessage) return 'video';
    if (msg.message?.audioMessage) return 'audio';
    if (msg.message?.documentMessage) return 'document';
    if (msg.message?.stickerMessage) return 'sticker';
    if (msg.message?.contactMessage) return 'contact';
    if (msg.message?.locationMessage) return 'location';
    return 'unknown';
}

// ============================================
// AI CHAT FUNCTIONS
// ============================================
async function chatWithGemini(text) {
    if (!genAI) return null;
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(text);
        return result.response.text();
    } catch (e) {
        console.error('Gemini Error:', e.message);
        return null;
    }
}

async function chatWithOpenAI(text) {
    if (!openai) return null;
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: text }]
        });
        return completion.choices[0].message.content;
    } catch (e) {
        console.error('OpenAI Error:', e.message);
        return null;
    }
}

async function getAIResponse(text) {
    if (config.openaiApiKey) {
        const response = await chatWithOpenAI(text);
        if (response) return response;
    }
    if (config.googleApiKey) {
        const response = await chatWithGemini(text);
        if (response) return response;
    }
    return 'AI services not configured. Add API key in .env';
}

// ============================================
// TIKTOK DOWNLOADER
// ============================================
async function downloadTikTok(url) {
    try {
        // Try multiple APIs
        const apis = [
            `https://tikwm.com/api/?url=${encodeURIComponent(url)}`,
            `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`
        ];
        
        for (const apiUrl of apis) {
            try {
                const response = await axios.get(apiUrl, { timeout: 30000 });
                
                // tikwm API
                if (response.data && response.data.code === 0) {
                    return {
                        success: true,
                        video: response.data.data?.play || response.data.data?.hdplay,
                        author: response.data.data?.author?.nickname || 'Unknown',
                        caption: response.data.data?.title || '',
                        likes: response.data.data?.digg_count || 0,
                        comments: response.data.data?.comment_count || 0
                    };
                }
                
                // douyin.wtf API
                if (response.data && response.data.status === 'success') {
                    return {
                        success: true,
                        video: response.data.data?.video?.download || response.data.data?.video?.play_addr,
                        author: response.data.data?.author?.nickname || 'Unknown',
                        caption: response.data.data?.desc || '',
                        likes: response.data.data?.statistics?.digg_count || 0,
                        comments: response.data.data?.statistics?.comment_count || 0
                    };
                }
            } catch (e) {
                console.log(`[TikTok] API failed: ${apiUrl}`);
                continue;
            }
        }
        
        return { success: false, error: 'All APIs failed' };
    } catch (e) {
        console.error('TikTok Download Error:', e.message);
        return { success: false, error: e.message };
    }
}

function extractTikTokUrl(text) {
    const tiktokRegex = /(?:https?:\/\/)?(?:www\.|vm\.|vt\.)?(?:tiktok\.com\/@[^\s]+\/video\/\d+|tiktok\.com\/t\/[^\s]+|vm\.tiktok\.com\/[^\s]+)/gi;
    const matches = text.match(tiktokRegex);
    return matches ? matches[0] : null;
}

// ============================================
// STICKER HANDLER
// ============================================
async function createSticker(msg, sock) {
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const { Sticker, StickerTypes } = require('wa-sticker-formatter');
        
        const sticker = new Sticker(buffer, {
            pack: config.stickerPackName,
            author: config.stickerPackAuthor,
            type: StickerTypes.FULL,
            quality: 70
        });
        
        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(msg.key.remoteJid, { sticker: stickerBuffer });
        return true;
    } catch (e) {
        console.error('Sticker Error:', e);
        return false;
    }
}

// ============================================
// VIEW ONCE HANDLER
// ============================================
async function handleViewOnce(msg, sock) {
    try {
        const chatId = msg.key.remoteJid;
        const message = msg.message;
        
        // Check for view once image
        if (message?.imageMessage?.viewOnce) {
            viewOnceStorage.set(chatId, {
                message: msg,
                mediaType: 'image',
                timestamp: Date.now()
            });
            console.log(`[View Once] Image stored for chat: ${chatId}`);
            return;
        }
        
        // Check for view once video
        if (message?.videoMessage?.viewOnce) {
            viewOnceStorage.set(chatId, {
                message: msg,
                mediaType: 'video',
                timestamp: Date.now()
            });
            console.log(`[View Once] Video stored for chat: ${chatId}`);
            return;
        }
        
        // Check for view once in extended text message (quoted)
        const quotedImage = message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
        const quotedVideo = message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
        
        if (quotedImage?.viewOnce || quotedVideo?.viewOnce) {
            const quotedMsg = message.extendedTextMessage.contextInfo.quotedMessage;
            const quotedKey = message.extendedTextMessage.contextInfo.stanzaId;
            
            // Reconstruct the message with proper key
            const reconstructedMsg = {
                key: {
                    remoteJid: chatId,
                    id: quotedKey,
                    fromMe: false
                },
                message: quotedMsg
            };
            
            viewOnceStorage.set(chatId, {
                message: reconstructedMsg,
                mediaType: quotedImage ? 'image' : 'video',
                timestamp: Date.now()
            });
            console.log(`[View Once] Quoted ${quotedImage ? 'image' : 'video'} stored for chat: ${chatId}`);
            return;
        }
    } catch (e) {
        console.error('View Once Handler Error:', e);
    }
}

async function saveViewOnce(msg, sock) {
    try {
        const chatId = msg.key.remoteJid;
        
        // Check quoted message for view once
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        let mediaMsg = null;
        let mediaType = null;
        
        if (quotedMsg?.imageMessage?.viewOnce || quotedMsg?.imageMessage) {
            const quotedKey = msg.message.extendedTextMessage.contextInfo.stanzaId;
            mediaMsg = {
                key: {
                    remoteJid: chatId,
                    id: quotedKey,
                    fromMe: false
                },
                message: quotedMsg
            };
            mediaType = 'image';
        } else if (quotedMsg?.videoMessage?.viewOnce || quotedMsg?.videoMessage) {
            const quotedKey = msg.message.extendedTextMessage.contextInfo.stanzaId;
            mediaMsg = {
                key: {
                    remoteJid: chatId,
                    id: quotedKey,
                    fromMe: false
                },
                message: quotedMsg
            };
            mediaType = 'video';
        } else {
            // Check stored view once
            const stored = viewOnceStorage.get(chatId);
            if (stored) {
                mediaMsg = stored.message;
                mediaType = stored.mediaType;
            }
        }
        
        if (!mediaMsg) {
            await sock.sendMessage(chatId, { 
                text: '❌ Reply to a view once message with !vv to save it.\n\nOr send a view once first, then reply with !vv' 
            });
            return false;
        }
        
        await sock.sendMessage(chatId, { text: '⏳ Saving media...' });
        
        // Download the media
        const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
        
        // Generate filename
        const timestamp = moment().format('YYYYMMDD_HHmmss');
        const extension = mediaType === 'image' ? 'jpg' : 'mp4';
        const filename = `viewonce_${timestamp}.${extension}`;
        const filepath = path.join(VIEW_ONCE_DIR, filename);
        
        // Save to file
        await fs.writeFile(filepath, buffer);
        
        const caption = `✅ View once ${mediaType} saved!\n📁 File: ${filename}`;
        
        if (mediaType === 'image') {
            await sock.sendMessage(chatId, { 
                image: buffer, 
                caption: caption
            });
        } else {
            await sock.sendMessage(chatId, { 
                video: buffer, 
                caption: caption
            });
        }
        
        console.log(`[View Once] Saved: ${filepath}`);
        return true;
        
    } catch (e) {
        console.error('Save View Once Error:', e);
        await sock.sendMessage(msg.key.remoteJid, { 
            text: '❌ Failed to save media. View once media may have expired.' 
        });
        return false;
    }
}

// ============================================
// COMMAND HANDLER
// ============================================
async function handleCommand(sock, msg, command, args, db) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const senderNumber = formatNumber(sender.replace(/@s.whatsapp.net/, '').replace(/@g.us/, ''));
    const isBotOwner = senderNumber === formatNumber(config.ownerNumber);
    
    switch (command.toLowerCase()) {
        case 'menu':
        case 'help':
            const menuText = `╔══════════════════════════════════╗
║       *${config.botName}* Bot       
╚══════════════════════════════════╝

*📝 GENERAL*
  ${config.botPrefix}menu      ─  Show this menu
  ${config.botPrefix}ping      ─  Check bot status
  ${config.botPrefix}runtime   ─  Bot uptime
  ${config.botPrefix}owner     ─  Bot owner info
  ${config.botPrefix}info      ─  Bot info
  ${config.botPrefix}speed     ─  Test speed

*🎨 MEDIA*
  ${config.botPrefix}sticker   ─  Image/video → sticker
  ${config.botPrefix}vv        ─  Save view once
  ${config.botPrefix}tomp3     ─  Video → audio

*📥 DOWNLOAD*
  ${config.botPrefix}tiktok    ─  Download TikTok
  ${config.botPrefix}tt        ─  Download TikTok
  *Auto-detect:* Send TikTok link

*🤖 AI CHAT*
  ${config.botPrefix}ai        ─  Chat with AI
  ${config.botPrefix}gpt       ─  ChatGPT
  ${config.botPrefix}gemini    ─  Gemini AI
  ${config.botPrefix}translate ─  Translate text
  ${config.botPrefix}define    ─  Define a word

*🔧 TOOLS*
  ${config.botPrefix}calc      ─  Calculator
  ${config.botPrefix}reverse   ─  Reverse text
  ${config.botPrefix}binary    ─  Text → binary
  ${config.botPrefix}quote     ─  Random quote
  ${config.botPrefix}joke      ─  Random joke
  ${config.botPrefix}weather   ─  Weather info

*📱 STATUS*
  ${config.botPrefix}autowatch ─  Toggle auto view
  ${config.botPrefix}autolike  ─  Toggle auto react
  ${config.botPrefix}statusinfo ─ Check settings

*👥 GROUP*
  ${config.botPrefix}tagall    ─  Mention all
  ${config.botPrefix}hidetag   ─  Hidden tag all
  ${config.botPrefix}kick      ─  Remove member
  ${config.botPrefix}promote   ─  Make admin
  ${config.botPrefix}demote    ─  Remove admin
  ${config.botPrefix}antilink  ─  Toggle antilink
  ${config.botPrefix}welcome   ─  Toggle welcome

*👑 OWNER*
  ${config.botPrefix}restart   ─  Restart bot
  ${config.botPrefix}leave     ─  Bot leave group

╚══════════════════════════════════╝
_Bot by Max Shadows_`;
            
            try {
                const menuImagePath = path.join(__dirname, 'menu-image.png');
                if (fs.existsSync(menuImagePath)) {
                    const menuImageBuffer = await fs.readFile(menuImagePath);
                    await sock.sendMessage(chatId, { 
                        image: menuImageBuffer, 
                        caption: menuText 
                    });
                } else {
                    await sock.sendMessage(chatId, { text: menuText });
                }
            } catch (e) {
                await sock.sendMessage(chatId, { text: menuText });
            }
            break;

        case 'ping': {
            const startTime = Date.now();
            await sock.sendMessage(chatId, { text: '⚡ Pinging...' });
            const latency = Date.now() - startTime;
            await sock.sendMessage(chatId, { text: `*Pong!*\n⚡ Latency: ${latency}ms` });
            break;
        }

        case 'speed': {
            const startTime = Date.now();
            const msg = await sock.sendMessage(chatId, { text: '⏱️ Testing speed...' });
            const speed = Date.now() - startTime;
            await sock.sendMessage(chatId, { text: `⚡ *Speed Test Results*\n\n📬 Send: ${speed}ms\n🔄 Response: ${Date.now() - startTime}ms` });
            break;
        }

        case 'runtime':
        case 'uptime': {
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            const runtimeText = `⏱️ *Bot Runtime*\n\nHours: ${hours}\nMinutes: ${minutes}\nSeconds: ${seconds}`;
            await sock.sendMessage(chatId, { text: runtimeText });
            break;
        }

        case 'owner': {
            const ownerText = `👑 *Bot Owner*\n\nName: ${config.botName}\nNumber: ${config.ownerNumber}\n\nBot by Max Shadows`;
            await sock.sendMessage(chatId, { text: ownerText });
            break;
        }

        case 'info': {
            const nodeVersion = process.version;
            const platform = process.platform;
            const infoText = `ℹ️ *Bot Information*\n\n🤖 Name: ${config.botName}\n📱 Platform: ${platform}\n💚 Node.js: ${nodeVersion}\n⏱️ Uptime: ${Math.floor(process.uptime() / 60)} mins\n📊 RAM: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`;
            await sock.sendMessage(chatId, { text: infoText });
            break;
        }

        case 'sticker': {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg?.imageMessage && !quotedMsg?.videoMessage && !msg.message?.imageMessage && !msg.message?.videoMessage) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}sticker\n\nReply to an image/video or send with an image.` });
                return;
            }
            await sock.sendMessage(chatId, { text: '⏳ Creating sticker...' });
            const stickerResult = await createSticker(msg, sock);
            if (!stickerResult) {
                await sock.sendMessage(chatId, { text: '❌ Failed to create sticker.' });
            }
            break;
        }

        case 'vv': {
            const result = await saveViewOnce(msg, sock);
            if (!result) {
                await sock.sendMessage(chatId, { text: '❌ No view once media found. Reply to a view once message.' });
            }
            break;
        }

        case 'tomp3': {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg?.videoMessage && !msg.message?.videoMessage) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}tomp3\n\nReply to a video or send with a video.` });
                return;
            }
            await sock.sendMessage(chatId, { text: '⏳ Converting to audio...' });
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                await sock.sendMessage(chatId, { 
                    audio: buffer, 
                    mimetype: 'audio/mpeg',
                    ptt: false 
                });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Failed to convert video.' });
            }
            break;
        }

        case 'tiktok':
        case 'tt': {
            const tiktokUrl = args[0] || extractTikTokUrl(messageText);
            if (!tiktokUrl) {
                await sock.sendMessage(chatId, { 
                    text: `Usage: ${config.botPrefix}tiktok <url>\n\nOr just send a TikTok link!` 
                });
                return;
            }
            
            if (!tiktokUrl.includes('tiktok.com')) {
                await sock.sendMessage(chatId, { text: '❌ Invalid TikTok URL.' });
                return;
            }
            
            await sock.sendMessage(chatId, { text: '⏳ Downloading TikTok video...' });
            
            const result = await downloadTikTok(tiktokUrl);
            
            if (result.success && result.video) {
                try {
                    const videoResponse = await axios.get(result.video, { 
                        responseType: 'arraybuffer',
                        timeout: 60000 
                    });
                    const videoBuffer = Buffer.from(videoResponse.data);
                    
                    const caption = `📱 *TikTok Video*\n\n👤 Author: ${result.author}\n❤️ Likes: ${result.likes.toLocaleString()}\n💬 Comments: ${result.comments.toLocaleString()}\n\n📝 ${result.caption || 'No caption'}`;
                    
                    await sock.sendMessage(chatId, { 
                        video: videoBuffer,
                        caption: caption
                    });
                } catch (e) {
                    console.error('Video Download Error:', e);
                    await sock.sendMessage(chatId, { text: '❌ Failed to download video. Try again later.' });
                }
            } else {
                await sock.sendMessage(chatId, { 
                    text: `❌ Failed to download: ${result.error || 'Unknown error'}` 
                });
            }
            break;
        }

        case 'autowatch': {
            const userSettings = getUserSettings(db, sender);
            userSettings.autoWatchStatus = !userSettings.autoWatchStatus;
            saveDB(db);
            const status = userSettings.autoWatchStatus ? '✅ ON' : '❌ OFF';
            console.log(`[Auto Watch] Toggle: ${status} for ${sender}`);
            await sock.sendMessage(chatId, { 
                text: `👁️ *Auto Watch Status:* ${status}\n\nWhen ON, bot will automatically view all status updates.\n\n⚠️ Note: Works when friends post status updates.` 
            });
            break;
        }

        case 'autolike': {
            const userSettings = getUserSettings(db, sender);
            userSettings.autoLikeStatus = !userSettings.autoLikeStatus;
            saveDB(db);
            const status = userSettings.autoLikeStatus ? '✅ ON' : '❌ OFF';
            console.log(`[Auto Like] Toggle: ${status} for ${sender}`);
            await sock.sendMessage(chatId, { 
                text: `❤️ *Auto Like Status:* ${status}\n\nWhen ON, bot will automatically like all status updates.\n\n⚠️ Note: Works when friends post status updates.` 
            });
            break;
        }

        case 'statusinfo': {
            const userSettings = getUserSettings(db, sender);
            await sock.sendMessage(chatId, { 
                text: `📱 *Your Status Settings*\n\n👁️ Auto Watch: ${userSettings.autoWatchStatus ? '✅ ON' : '❌ OFF'}\n❤️ Auto Like: ${userSettings.autoLikeStatus ? '✅ ON' : '❌ OFF'}\n\nUse ${config.botPrefix}autowatch or ${config.botPrefix}autolike to toggle.` 
            });
            break;
        }

        case 'watchstatus': {
            await sock.sendMessage(chatId, { text: '⏳ Status watching is now enabled!\n\nNew status updates will be automatically viewed.' });
            break;
        }

        case 'ai':
            if (!config.enableAiChat) {
                await sock.sendMessage(chatId, { text: '❌ AI chat is disabled.' });
                return;
            }
            const aiText = args.join(' ');
            if (!aiText) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}ai <text>` });
                return;
            }
            await sock.sendMessage(chatId, { text: '🤔 Thinking...' });
            const aiResponse = await getAIResponse(aiText);
            await sock.sendMessage(chatId, { text: aiResponse });
            break;

        case 'gpt':
            if (!config.openaiApiKey) {
                await sock.sendMessage(chatId, { text: '❌ OpenAI API key not set.' });
                return;
            }
            const gptText = args.join(' ');
            if (!gptText) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}gpt <text>` });
                return;
            }
            await sock.sendMessage(chatId, { text: '🤖 Thinking...' });
            const gptResponse = await chatWithOpenAI(gptText);
            await sock.sendMessage(chatId, { text: gptResponse || 'Error getting response.' });
            break;

        case 'gemini':
            if (!config.googleApiKey) {
                await sock.sendMessage(chatId, { text: '❌ Google API key not set.' });
                return;
            }
            const geminiText = args.join(' ');
            if (!geminiText) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}gemini <text>` });
                return;
            }
            await sock.sendMessage(chatId, { text: '🧠 Thinking...' });
            const geminiResponse = await chatWithGemini(geminiText);
            await sock.sendMessage(chatId, { text: geminiResponse || 'Error getting response.' });
            break;

        case 'translate': {
            const lang = args[0];
            const text = args.slice(1).join(' ');
            if (!lang || !text) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}translate <lang> <text>\n\nExample: ${config.botPrefix}translate es hello world` });
                return;
            }
            try {
                const translateUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${lang}`;
                const response = await axios.get(translateUrl);
                const translated = response.data.responseData.translatedText;
                await sock.sendMessage(chatId, { text: `🌐 *Translation*\n\nOriginal: ${text}\nTranslated (${lang}): ${translated}` });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Translation failed.' });
            }
            break;
        }

        case 'define': {
            const word = args[0];
            if (!word) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}define <word>` });
                return;
            }
            try {
                const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
                const data = response.data[0];
                const meaning = data.meanings[0];
                const definition = meaning.definitions[0].definition;
                const example = meaning.definitions[0].example || 'No example';
                await sock.sendMessage(chatId, { 
                    text: `📖 *${data.word}*\n\n📝 ${definition}\n\n💬 Example: ${example}\n\n🔊 ${data.phonetics[0]?.text || ''}` 
                });
            } catch (e) {
                await sock.sendMessage(chatId, { text: `❌ Could not find definition for "${word}"` });
            }
            break;
        }

        case 'calc': {
            const expression = args.join(' ');
            if (!expression) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}calc <expression>\n\nExample: ${config.botPrefix}calc 2+2*3` });
                return;
            }
            try {
                const sanitized = expression.replace(/[^0-9+\-*/().]/g, '');
                const result = eval(sanitized);
                await sock.sendMessage(chatId, { text: `🔢 *Calculator*\n\nExpression: ${expression}\nResult: ${result}` });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Invalid math expression.' });
            }
            break;
        }

        case 'reverse': {
            const text = args.join(' ');
            if (!text) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}reverse <text>` });
                return;
            }
            const reversed = text.split('').reverse().join('');
            await sock.sendMessage(chatId, { text: `🔄 *Reversed:* ${reversed}` });
            break;
        }

        case 'binary': {
            const text = args.join(' ');
            if (!text) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}binary <text>` });
                return;
            }
            const binary = text.split('').map(char => char.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
            await sock.sendMessage(chatId, { text: `🔢 *Binary:* ${binary}` });
            break;
        }

        case 'quote': {
            try {
                const response = await axios.get('https://api.quotable.io/random');
                const { content, author } = response.data;
                await sock.sendMessage(chatId, { text: `💫 *Quote*\n\n"${content}"\n\n— ${author}` });
            } catch (e) {
                const quotes = [
                    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
                    { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
                    { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
                    { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
                    { text: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" }
                ];
                const quote = quotes[Math.floor(Math.random() * quotes.length)];
                await sock.sendMessage(chatId, { text: `💫 *Quote*\n\n"${quote.text}"\n\n— ${quote.author}` });
            }
            break;
        }

        case 'joke': {
            try {
                const response = await axios.get('https://official-joke-api.appspot.com/random_joke');
                const { setup, punchline } = response.data;
                await sock.sendMessage(chatId, { text: `😄 *Joke*\n\n${setup}\n\n${punchline}` });
            } catch (e) {
                const jokes = [
                    { setup: "Why don't scientists trust atoms?", punchline: "Because they make up everything!" },
                    { setup: "Why did the scarecrow win an award?", punchline: "Because he was outstanding in his field!" },
                    { setup: "What do you call a fake noodle?", punchline: "An impasta!" },
                    { setup: "Why don't eggs tell jokes?", punchline: "They'd crack each other up!" },
                    { setup: "What do you call a bear with no teeth?", punchline: "A gummy bear!" }
                ];
                const joke = jokes[Math.floor(Math.random() * jokes.length)];
                await sock.sendMessage(chatId, { text: `😄 *Joke*\n\n${joke.setup}\n\n${joke.punchline}` });
            }
            break;
        }

        case 'weather': {
            const city = args.join(' ');
            if (!city) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}weather <city>\n\nExample: ${config.botPrefix}weather London` });
                return;
            }
            try {
                const response = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=4`);
                await sock.sendMessage(chatId, { text: `🌤️ *Weather*\n\n${response.data}` });
            } catch (e) {
                await sock.sendMessage(chatId, { text: `❌ Could not get weather for "${city}"` });
            }
            break;
        }

        case 'tagall':
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: '❌ This command only works in groups.' });
                return;
            }
            try {
                const groupMetadata = await sock.groupMetadata(chatId);
                const participants = groupMetadata.participants;
                let tagText = '📢 *All Members*\n\n';
                participants.forEach((p, i) => {
                    tagText += `@${p.id.replace(/@s.whatsapp.net/, '')}`;
                    if (i < participants.length - 1) tagText += '\n';
                });
                await sock.sendMessage(chatId, { 
                    text: tagText, 
                    mentions: participants.map(p => p.id) 
                });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Error fetching group info.' });
            }
            break;

        case 'hidetag':
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: '❌ This command only works in groups.' });
                return;
            }
            try {
                const groupMetadata = await sock.groupMetadata(chatId);
                const participants = groupMetadata.participants;
                const text = args.join(' ') || '👋 Hello everyone!';
                await sock.sendMessage(chatId, { 
                    text: text, 
                    mentions: participants.map(p => p.id) 
                });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Error fetching group info.' });
            }
            break;

        case 'kick':
            if (!isGroup || !isBotOwner) {
                await sock.sendMessage(chatId, { text: '❌ Owner only command in groups.' });
                return;
            }
            const kickUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                            args[0]?.replace('@', '') + '@s.whatsapp.net';
            if (!kickUser) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}kick @user` });
                return;
            }
            try {
                await sock.groupParticipantsUpdate(chatId, [kickUser], 'remove');
                await sock.sendMessage(chatId, { text: '✅ User removed from group.' });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Failed to remove user.' });
            }
            break;

        case 'promote':
            if (!isGroup || !isBotOwner) {
                await sock.sendMessage(chatId, { text: '❌ Owner only command in groups.' });
                return;
            }
            const promoteUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                               args[0]?.replace('@', '') + '@s.whatsapp.net';
            if (!promoteUser) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}promote @user` });
                return;
            }
            try {
                await sock.groupParticipantsUpdate(chatId, [promoteUser], 'promote');
                await sock.sendMessage(chatId, { text: '✅ User promoted to admin.' });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Failed to promote user.' });
            }
            break;

        case 'demote':
            if (!isGroup || !isBotOwner) {
                await sock.sendMessage(chatId, { text: '❌ Owner only command in groups.' });
                return;
            }
            const demoteUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                              args[0]?.replace('@', '') + '@s.whatsapp.net';
            if (!demoteUser) {
                await sock.sendMessage(chatId, { text: `Usage: ${config.botPrefix}demote @user` });
                return;
            }
            try {
                await sock.groupParticipantsUpdate(chatId, [demoteUser], 'demote');
                await sock.sendMessage(chatId, { text: '✅ User demoted from admin.' });
            } catch (e) {
                await sock.sendMessage(chatId, { text: '❌ Failed to demote user.' });
            }
            break;

        case 'antilink': {
            if (!isGroup || !isBotOwner) {
                await sock.sendMessage(chatId, { text: '❌ Owner only command in groups.' });
                return;
            }
            const groupSettings = db.groups[chatId] || {};
            groupSettings.antilink = !groupSettings.antilink;
            db.groups[chatId] = groupSettings;
            saveDB(db);
            const status = groupSettings.antilink ? '✅ ON' : '❌ OFF';
            await sock.sendMessage(chatId, { text: `🔗 *Antilink:* ${status}\n\nWhen ON, links from non-admins will be deleted.` });
            break;
        }

        case 'welcome': {
            if (!isGroup || !isBotOwner) {
                await sock.sendMessage(chatId, { text: '❌ Owner only command in groups.' });
                return;
            }
            const groupSettings = db.groups[chatId] || {};
            groupSettings.welcome = !groupSettings.welcome;
            db.groups[chatId] = groupSettings;
            saveDB(db);
            const status = groupSettings.welcome ? '✅ ON' : '❌ OFF';
            await sock.sendMessage(chatId, { text: `👋 *Welcome Message:* ${status}\n\nWhen ON, new members get a welcome message.` });
            break;
        }

        case 'leave': {
            if (!isBotOwner) {
                await sock.sendMessage(chatId, { text: '❌ Owner only command.' });
                return;
            }
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: '❌ This command only works in groups.' });
                return;
            }
            await sock.sendMessage(chatId, { text: '👋 Leaving group...' });
            await sock.groupLeave(chatId);
            break;
        }

        case 'restart':
            if (!isBotOwner) {
                await sock.sendMessage(chatId, { text: '❌ Owner only command.' });
                return;
            }
            await sock.sendMessage(chatId, { text: '🔄 Restarting bot...' });
            setTimeout(() => process.exit(0), 1000);
            break;

        default:
            await sock.sendMessage(chatId, { 
                text: `❌ Unknown command. Use ${config.botPrefix}menu to see available commands.` 
            });
    }
}

// ============================================
// MAIN BOT FUNCTION
// ============================================
async function startBot() {
    console.log(`\n${config.botName} Bot Starting...\n`);
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        browser: ['Chrome', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: true
    });

    // Store main socket globally for pairing API
    mainSock = sock;
    mainSaveCreds = saveCreds;

    // Save credentials on update - MUST await before handling close
    sock.ev.on('creds.update', async () => {
        await saveCreds();
    });

    // Connection updates
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update;
        
        if (qr) {
            console.log('\n📱 Scan QR Code below:\n');
            qrcode.generate(qr, { small: true });
        }
        
        // After pairing success, WA sends 515 (restartRequired) - this is EXPECTED
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Connection closed. Reason: ${reason}`);
            
            // 515 = restartRequired (expected after pair-success)
            // Must reconnect IMMEDIATELY - no delay, no max attempts
            if (reason === 515 || reason === DisconnectReason.restartRequired) {
                console.log('Pairing successful! Reconnecting with new credentials...');
                mainSock = null;
                startBot();
            } else if (reason !== DisconnectReason.loggedOut) {
                console.log('Reconnecting in 5s...');
                mainSock = null;
                setTimeout(() => startBot(), 5000);
            } else {
                console.log('Logged out. Please scan QR again.');
                mainSock = null;
                setTimeout(() => startBot(), 3000);
            }
        }
        
        if (connection === 'open') {
            console.log(`\n✅ ${config.botName} Bot is Online!\n`);
            console.log(`Bot is ready to receive commands.`);
        }
    });

    // Message handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            // Skip status broadcasts
            if (msg.key.remoteJid === 'status@broadcast') continue;
            
            const chatId = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const isGroup = chatId.endsWith('@g.us');
            const isFromMe = msg.key.fromMe;
            
            // Debug: Log received message
            console.log(`[Message] From: ${sender}, Chat: ${chatId}, fromMe: ${isFromMe}`);
            
            // Handle view once messages FIRST (before any other processing)
            await handleViewOnce(msg, sock);
            
            // Get message content
            let messageText = '';
            if (msg.message?.conversation) {
                messageText = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                messageText = msg.message.extendedTextMessage.text;
            } else if (msg.message?.imageMessage?.caption) {
                messageText = msg.message.imageMessage.caption;
            } else if (msg.message?.videoMessage?.caption) {
                messageText = msg.message.videoMessage.caption;
            }
            
            // Debug: Log message text
            console.log(`[Message Text] ${messageText}`);
            
            // Check for commands
            if (messageText.startsWith(config.botPrefix)) {
                const [command, ...args] = messageText.slice(config.botPrefix.length).trim().split(/\s+/);
                console.log(`[Command] ${command} with args: ${args.join(' ')} (fromMe: ${isFromMe})`);
                
                // If message is fromMe (owner), check if it's in "Message Yourself" or a regular chat
                // Allow owner to use commands in any chat
                await handleCommand(sock, msg, command, args, loadDB());
                continue;
            }
            
            // Antilink check (only for groups, skip own messages and admins)
            if (isGroup && !isFromMe) {
                const db = loadDB();
                const groupSettings = db.groups[chatId] || {};
                if (groupSettings.antilink && messageText.match(/https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.link|\.chat|\.me|\.wa/)) {
                    try {
                        const groupMetadata = await sock.groupMetadata(chatId);
                        const participants = groupMetadata.participants;
                        const senderIsAdmin = participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));
                        
                        if (!senderIsAdmin) {
                            await sock.sendMessage(chatId, { text: '🔗 Links are not allowed in this group!' });
                            // Delete the message
                            await sock.sendMessage(chatId, { delete: msg.key });
                            continue;
                        }
                    } catch (e) {
                        console.error('Antilink Error:', e);
                    }
                }
            }
            
            // Auto-detect TikTok links (skip own messages to avoid loops)
            const tiktokLink = extractTikTokUrl(messageText);
            if (tiktokLink && !messageText.startsWith(config.botPrefix) && !isFromMe) {
                await sock.sendMessage(chatId, { text: '📱 TikTok link detected! Downloading...' });
                
                const result = await downloadTikTok(tiktokLink);
                
                if (result.success && result.video) {
                    try {
                        const videoResponse = await axios.get(result.video, { 
                            responseType: 'arraybuffer',
                            timeout: 60000 
                        });
                        const videoBuffer = Buffer.from(videoResponse.data);
                        
                        const caption = `📱 *TikTok Video*\n\n👤 Author: ${result.author}\n❤️ Likes: ${result.likes.toLocaleString()}\n💬 Comments: ${result.comments.toLocaleString()}\n\n📝 ${result.caption || 'No caption'}`;
                        
                        await sock.sendMessage(chatId, { 
                            video: videoBuffer,
                            caption: caption
                        });
                    } catch (e) {
                        console.error('Auto TikTok Download Error:', e);
                    }
                }
                continue;
            }
            
            // Auto-reply for private messages (skip own messages to avoid loops)
            if (config.enableAutoReply && !isGroup && !isFromMe) {
                if (messageText.toLowerCase() === 'hi' || messageText.toLowerCase() === 'hello') {
                    await sock.sendMessage(chatId, { 
                        text: `Hello! 👋 I'm ${config.botName}. Use ${config.botPrefix}menu to see commands.` 
                    });
                }
            }
            
            // AI chat in private messages (skip own messages to avoid loops)
            if (config.enableAiChat && !isGroup && !isFromMe && !messageText.startsWith(config.botPrefix)) {
                // Only respond to direct messages (not group mentions)
                if (!isGroup && messageText.length > 0 && Math.random() < 0.3) {
                    // Respond to 30% of messages to avoid spam
                    const aiResponse = await getAIResponse(messageText);
                    if (aiResponse) {
                        await sock.sendMessage(chatId, { text: aiResponse });
                    }
                }
            }
        }
    });

    // Group participants update
    sock.ev.on('group-participants.update', async (update) => {
        if (!config.enableGroupControl) return;
        
        const { id, participants, action } = update;
        const db = loadDB();
        const groupSettings = db.groups[id] || {};
        
        for (const participant of participants) {
            const jid = typeof participant === 'string' ? participant : participant.id;
            const number = jid.replace(/@s.whatsapp.net/, '').replace(/@g.us/, '');
            
            if (action === 'add' && groupSettings.welcome !== false) {
                await sock.sendMessage(id, { 
                    text: `👋 Welcome @${number}!\nUse ${config.botPrefix}menu to see commands.`,
                    mentions: [jid]
                });
            } else if (action === 'remove') {
                await sock.sendMessage(id, { 
                    text: `👋 Goodbye @${number}!`
                });
            }
        }
    });

    // Status update handler (auto watch & like)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            // Only process status broadcasts
            if (msg.key.remoteJid !== 'status@broadcast') continue;
            if (msg.key.fromMe) continue; // Skip own status
            
            const statusFrom = msg.key.participant || 'unknown';
            console.log(`[Status] New status from: ${statusFrom}`);
            
            const db = loadDB();
            const ownerSettings = getUserSettings(db, config.ownerNumber + '@s.whatsapp.net');
            
            // Auto watch status - send proper read receipt for status
            if (ownerSettings.autoWatchStatus) {
                try {
                    // Send presence update to indicate viewing
                    await sock.sendPresenceUpdate('available');
                    
                    // Send read receipt for status
                    await sock.readMessages([msg.key]);
                    
                    // Additional: send presence composing briefly
                    await sock.sendPresenceUpdate('composing', 'status@broadcast');
                    await new Promise(r => setTimeout(r, 1000));
                    await sock.sendPresenceUpdate('paused', 'status@broadcast');
                    
                    console.log(`[Auto Watch] Viewed status from ${statusFrom}`);
                } catch (e) {
                    console.error('[Auto Watch] Error:', e.message);
                }
            }
            
            // Auto like status - send reaction to status
            if (ownerSettings.autoLikeStatus) {
                try {
                    const reactions = ['❤️', '🔥', '😍', '👏', '💯', '✨', '🙌', '😘'];
                    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                    
                    // Send reaction to status broadcast
                    await sock.sendMessage('status@broadcast', {
                        react: {
                            text: randomReaction,
                            key: msg.key
                        }
                    });
                    
                    console.log(`[Auto Like] Reacted ${randomReaction} to status from ${statusFrom}`);
                } catch (e) {
                    console.error('[Auto Like] Error:', e.message);
                }
            }
        }
    });

    return sock;
}

// ============================================
// START BOT
// ============================================
startBot().catch(console.error);
