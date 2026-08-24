const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    proto
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
app.get('/', (req, res) => res.send(`${config.botName} is Running!`));
app.get('/status', (req, res) => res.json({ status: 'online', bot: config.botName }));
app.listen(config.port, () => console.log(`Server running on port ${config.port}`));

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
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
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
        // Using a free TikTok API
        const apiUrl = `https://api.tiklydown.me/api/download?url=${encodeURIComponent(url)}`;
        const response = await axios.get(apiUrl, { timeout: 30000 });
        
        if (response.data && response.data.success !== false) {
            return {
                success: true,
                video: response.data.video?.download || response.data.video?.no_watermark,
                author: response.data.author?.nickname || 'Unknown',
                caption: response.data.title || '',
                likes: response.data.stats?.likes || 0,
                comments: response.data.stats?.comments || 0
            };
        }
        
        // Alternative API
        const altApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
        const altResponse = await axios.get(altApiUrl, { timeout: 30000 });
        
        if (altResponse.data && altResponse.data.code === 0) {
            return {
                success: true,
                video: altResponse.data.data?.play,
                author: altResponse.data.data?.author?.nickname || 'Unknown',
                caption: altResponse.data.data?.title || '',
                likes: altResponse.data.data?.digg_count || 0,
                comments: altResponse.data.data?.comment_count || 0
            };
        }
        
        return { success: false, error: 'Could not fetch video' };
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
        const { downloadMediaMessage } = require('baileys');
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
        if (message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.viewOnce) {
            viewOnceStorage.set(chatId, {
                message: message.extendedTextMessage.contextInfo.quotedMessage,
                mediaType: 'image',
                timestamp: Date.now()
            });
            console.log(`[View Once] Quoted image stored for chat: ${chatId}`);
            return;
        }
        
        if (message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage?.viewOnce) {
            viewOnceStorage.set(chatId, {
                message: message.extendedTextMessage.contextInfo.quotedMessage,
                mediaType: 'video',
                timestamp: Date.now()
            });
            console.log(`[View Once] Quoted video stored for chat: ${chatId}`);
            return;
        }
    } catch (e) {
        console.error('View Once Handler Error:', e);
    }
}

async function saveViewOnce(msg, sock) {
    try {
        const { downloadMediaMessage } = require('baileys');
        const chatId = msg.key.remoteJid;
        
        const stored = viewOnceStorage.get(chatId);
        if (!stored) {
            await sock.sendMessage(chatId, { 
                text: '❌ No view once media found. Send a view once first, then reply with .vv' 
            });
            return false;
        }
        
        // Check if media is too old (5 minutes)
        if (Date.now() - stored.timestamp > 5 * 60 * 1000) {
            viewOnceStorage.delete(chatId);
            await sock.sendMessage(chatId, { 
                text: '❌ View once media expired. Send a new one.' 
            });
            return false;
        }
        
        await sock.sendMessage(chatId, { text: '⏳ Saving view once media...' });
        
        // Download the media
        const buffer = await downloadMediaMessage(stored.message, 'buffer', {});
        
        // Generate filename
        const timestamp = moment().format('YYYYMMDD_HHmmss');
        const extension = stored.mediaType === 'image' ? 'jpg' : 'mp4';
        const filename = `viewonce_${timestamp}.${extension}`;
        const filepath = path.join(VIEW_ONCE_DIR, filename);
        
        // Save to file
        await fs.writeFile(filepath, buffer);
        
        // Send the saved media back to user
        const sender = stored.message.key.participant || stored.message.key.remoteJid;
        const caption = `✅ View once ${stored.mediaType} saved!\n📁 File: ${filename}\n👤 From: @${sender.replace(/@s.whatsapp.net/, '').replace(/@g.us/, '')}`;
        
        if (stored.mediaType === 'image') {
            await sock.sendMessage(chatId, { 
                image: buffer, 
                caption: caption,
                mentions: [sender]
            });
        } else {
            await sock.sendMessage(chatId, { 
                video: buffer, 
                caption: caption,
                mentions: [sender]
            });
        }
        
        // Clear stored message
        viewOnceStorage.delete(chatId);
        
        console.log(`[View Once] Saved: ${filepath}`);
        return true;
        
    } catch (e) {
        console.error('Save View Once Error:', e);
        await sock.sendMessage(msg.key.remoteJid, { 
            text: '❌ Failed to save view once media.' 
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
            const menuText = `
╭━━━━━━━━━━━━━━━━━╮
┃   *${config.botName}* Menu
╰━━━━━━━━━━━━━━━━━╯

📐 *General Commands*
├ ${config.botPrefix}menu - Show this menu
├ ${config.botPrefix}ping - Check bot status
├ ${config.botPrefix}runtime - Bot uptime
├ ${config.botPrefix}sticker - Convert image to sticker
├ ${config.botPrefix}vv - Save view once media
└ ${config.botPrefix}owner - Bot owner info

📥 *Download Commands*
├ ${config.botPrefix}tiktok <url> - Download TikTok video
├ ${config.botPrefix}tt <url> - Download TikTok video
└ Auto-detect TikTok links in chat

🤖 *AI Commands*
├ ${config.botPrefix}ai <text> - Chat with AI
├ ${config.botPrefix}gpt <text> - ChatGPT
└ ${config.botPrefix}gemini <text> - Gemini AI

📱 *Status Commands*
├ ${config.botPrefix}autowatch - Toggle auto watch status
├ ${config.botPrefix}autolike - Toggle auto like status
├ ${config.botPrefix}statusinfo - Check status settings
└ ${config.botPrefix}watchstatus - Manually watch all status

👥 *Group Commands*
├ ${config.botPrefix}tagall - Mention all members
├ ${config.botPrefix}kick @user - Remove member
├ ${config.botPrefix}promote @user - Make admin
└ ${config.botPrefix}demote @user - Remove admin

👑 *Owner Commands*
├ ${config.botPrefix}restart - Restart bot
├ ${config.botPrefix}broadcast <text> - Send to all
└ ${config.botPrefix}block @user - Block user

⏰ *${getTimestamp()}*
`;
            await sock.sendMessage(chatId, { text: menuText });
            break;

        case 'ping':
            await sock.sendMessage(chatId, { text: '🏓 Pong! Bot is online.' });
            break;

        case 'runtime':
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            await sock.sendMessage(chatId, { 
                text: `⏱️ *Runtime:* ${hours}h ${minutes}m ${seconds}s` 
            });
            break;

        case 'sticker':
        case 's':
            if (msg.message?.imageMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                await sock.sendMessage(chatId, { text: '⏳ Creating sticker...' });
                const success = await createSticker(msg, sock);
                if (!success) {
                    await sock.sendMessage(chatId, { text: '❌ Failed to create sticker.' });
                }
            } else {
                await sock.sendMessage(chatId, { text: '📷 Reply to an image with .sticker' });
            }
            break;

        case 'owner':
            await sock.sendMessage(chatId, { 
                text: `👑 *Bot Owner*\nName: ${config.ownerName}\nNumber: ${config.ownerNumber}` 
            });
            break;

        case 'vv':
        case 'viewonce':
            await saveViewOnce(msg, sock);
            break;

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
        printQRInTerminal: true,
        browser: [config.botName, 'Chrome', '4.0.0'],
        generateHighQualityLinkPreview: true
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);

    // Connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📱 Scan QR Code below:\n');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Connection closed. Reason: ${reason}`);
            
            if (reason !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                startBot();
            } else {
                console.log('Logged out. Please scan QR again.');
            }
        }
        
        if (connection === 'open') {
            console.log(`\n✅ ${config.botName} Bot is Online!\n`);
        }
    });

    // Message handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            // Skip own messages and status broadcasts
            if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;
            
            const chatId = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const isGroup = chatId.endsWith('@g.us');
            
            // Debug: Log received message
            console.log(`[Message] From: ${sender}, Chat: ${chatId}`);
            
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
                console.log(`[Command] ${command} with args: ${args.join(' ')}`);
                await handleCommand(sock, msg, command, args, loadDB());
                continue;
            }
            
            // Auto-detect TikTok links
            const tiktokLink = extractTikTokUrl(messageText);
            if (tiktokLink && !messageText.startsWith(config.botPrefix)) {
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
            
            // Auto-reply for private messages
            if (config.enableAutoReply && !isGroup) {
                if (messageText.toLowerCase() === 'hi' || messageText.toLowerCase() === 'hello') {
                    await sock.sendMessage(chatId, { 
                        text: `Hello! 👋 I'm ${config.botName}. Use ${config.botPrefix}menu to see commands.` 
                    });
                }
            }
            
            // AI chat in private messages
            if (config.enableAiChat && !isGroup && !messageText.startsWith(config.botPrefix)) {
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
        
        for (const participant of participants) {
            if (action === 'add') {
                await sock.sendMessage(id, { 
                    text: `👋 Welcome @${participant.replace(/@s.whatsapp.net/, '')}!\nUse ${config.botPrefix}menu to see commands.`,
                    mentions: [participant]
                });
            } else if (action === 'remove') {
                await sock.sendMessage(id, { 
                    text: `👋 Goodbye @${participant.replace(/@s.whatsapp.net/, '')}!`
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
            
            console.log(`[Status] New status from: ${msg.key.participant || 'unknown'}`);
            
            const db = loadDB();
            const ownerSettings = getUserSettings(db, config.ownerNumber + '@s.whatsapp.net');
            
            // Auto watch status
            if (ownerSettings.autoWatchStatus) {
                try {
                    await sock.readMessages([msg.key]);
                    console.log(`[Auto Watch] Viewed status from ${msg.key.participant || 'unknown'}`);
                } catch (e) {
                    console.error('[Auto Watch] Error:', e.message);
                }
            }
            
            // Auto like status (react with emoji)
            if (ownerSettings.autoLikeStatus) {
                try {
                    const reactions = ['❤️', '🔥', '😍', '👏', '💯', '✨', '🙌', '😘'];
                    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                    
                    await sock.sendMessage(msg.key.remoteJid, {
                        react: {
                            text: randomReaction,
                            key: msg.key
                        }
                    });
                    console.log(`[Auto Like] Reacted ${randomReaction} to status from ${msg.key.participant || 'unknown'}`);
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
