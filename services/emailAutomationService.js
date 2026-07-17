/**
 * Email Automation Service
 * Handles email auto-replies and scheduled follow-ups
 */
const { google } = require('googleapis');
const SMTPService = require('./smtpService');
const DatabaseService = require('./database');
const axios = require('axios');
const pool = new DatabaseService().pool;

class EmailAutomationService {
    constructor() {
        this.smtpService = new SMTPService();
        this.pollInterval = 60000; // 1 minute
        this.isPolling = false;
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.lastAutoReplyTime = new Map(); // For rate limiting auto-replies per email (in-memory)
    }

    static getInstance() {
        if (!EmailAutomationService.instance) {
            EmailAutomationService.instance = new EmailAutomationService();
        }
        return EmailAutomationService.instance;
    }

    async start() {
        if (this.isPolling) return;
        this.isPolling = true;
        console.log('📧 Email Automation Service started');
        this.poll();
    }

    async stop() {
        this.isPolling = false;
    }

    async poll() {
        while (this.isPolling) {
            try {
                await this.checkNewEmails();
                // Note: Complex campaign follow-ups are handled by AutomationService.
                // This service specifically handles reactive auto-replies.
            } catch (error) {
                console.error('❌ Email polling error:', error);
            }
            // Wait for next poll interval
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }
    }

    async checkNewEmails() {
        const query = `
            SELECT * FROM smtp_connections 
            WHERE is_active = TRUE 
            AND (metadata->>'autoReplyEnabled')::boolean = TRUE
        `;
        const result = await pool.query(query);
        const connections = result.rows;

        for (const conn of connections) {
            try {
                if (conn.provider_name && conn.provider_name.toLowerCase().includes('gmail')) {
                    await this.processGmailAutoReply(conn);
                }
                // IMAP support would go here if libraries were available
            } catch (error) {
                console.error(`❌ Error processing auto-reply for ${conn.sender_email}:`, error);
            }
        }
    }

    async processGmailAutoReply(conn) {
        // Fetch tokens from user_google_sheets
        const tokenQuery = `
            SELECT access_token, refresh_token, token_expires_at 
            FROM user_google_sheets 
            WHERE user_email = $1 AND is_active = TRUE
            ORDER BY created_at DESC LIMIT 1
        `;
        const tokenResult = await pool.query(tokenQuery, [conn.user_email]);
        if (tokenResult.rows.length === 0) {
            console.log(`⚠️ No Google tokens found for ${conn.user_email}, skipping Gmail poll`);
            return;
        }

        const tokens = tokenResult.rows[0];
        
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_OAUTH_CLIENT_ID,
            process.env.GOOGLE_OAUTH_CLIENT_SECRET
        );

        oauth2Client.setCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.token_expires_at ? new Date(tokens.token_expires_at).getTime() : null
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        try {
            // List unread messages in inbox
            const res = await gmail.users.messages.list({
                userId: 'me',
                q: 'is:unread label:INBOX'
            });

            if (!res.data.messages || res.data.messages.length === 0) return;

            for (const msg of res.data.messages) {
                const message = await gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id
                });

                // Mark as read immediately to avoid double processing in next poll
                await gmail.users.messages.batchModify({
                    userId: 'me',
                    ids: [msg.id],
                    removeLabelIds: ['UNREAD']
                });

                const headers = message.data.payload.headers;
                const fromHeader = headers.find(h => h.name === 'From');
                const subjectHeader = headers.find(h => h.name === 'Subject');
                const fromLine = fromHeader ? fromHeader.value : '';
                const subject = subjectHeader ? subjectHeader.value : '';
                
                // Extract email address from "Name <email@example.com>"
                const emailMatch = fromLine.match(/<(.+?)>/) || [null, fromLine];
                const fromEmail = emailMatch[1].trim();

                // Rate limiting check: 1 reply per hour per sender to prevent loops
                const now = Date.now();
                const rateLimitKey = `${conn.user_email}_${fromEmail}`;
                const lastReply = this.lastAutoReplyTime.get(rateLimitKey) || 0;
                if (now - lastReply < 3600000) { 
                    console.log(`⏳ Rate limiting auto-reply to ${fromEmail} for ${conn.user_email}`);
                    continue;
                }

                // Plan limit check (highest tier first)
                const apiKeyQuery = `
                    SELECT id, auto_reply_limit FROM api_keys 
                    WHERE user_email = $1 AND is_active = true 
                    ORDER BY 
                      CASE plan_type 
                        WHEN 'enterprise' THEN 4 
                        WHEN 'pro' THEN 3 
                        WHEN 'basic' THEN 2 
                        WHEN 'trial' THEN 1 
                        WHEN 'free' THEN 0 
                        ELSE -1 
                      END DESC,
                      created_at DESC
                    LIMIT 1
                `;
                const apiKeyResult = await pool.query(apiKeyQuery, [conn.user_email]);
                
                if (apiKeyResult.rows.length > 0) {
                    const apiKey = apiKeyResult.rows[0];
                    if (apiKey.auto_reply_limit <= 0) {
                        console.log(`🚫 Auto-reply limit reached for ${conn.user_email}`);
                        continue;
                    }
                    // Decrement limit
                    await pool.query('UPDATE api_keys SET auto_reply_limit = auto_reply_limit - 1 WHERE id = $1', [apiKey.id]);
                }

                // Extract body
                let body = '';
                if (message.data.payload.parts) {
                    const part = message.data.payload.parts.find(p => p.mimeType === 'text/plain') || message.data.payload.parts[0];
                    if (part && part.body && part.body.data) {
                        body = Buffer.from(part.body.data, 'base64').toString();
                    }
                } else if (message.data.payload.body && message.data.payload.body.data) {
                    body = Buffer.from(message.data.payload.body.data, 'base64').toString();
                }

                // Generate AI response
                const metadata = typeof conn.metadata === 'string' ? JSON.parse(conn.metadata) : (conn.metadata || {});
                const prompt = metadata.autoReplyPrompt || "You are a helpful business assistant. Reply to the incoming email politely and professionally.";
                
                console.log(`🤖 Generating AI auto-reply for ${fromEmail}...`);
                const aiResponse = await this.generateAIResponse(body, prompt);

                if (aiResponse) {
                    // Send reply via SMTP (preferred for custom branding/limits)
                    await this.smtpService.sendEmail(
                        conn.connection_id,
                        fromEmail,
                        subject.startsWith('Re:') ? subject : `Re: ${subject}`,
                        aiResponse
                    );
                    
                    this.lastAutoReplyTime.set(rateLimitKey, now);
                    console.log(`✅ Auto-replied to ${fromEmail} via ${conn.sender_email}`);
                }
            }
        } catch (error) {
            if (error.message.includes('invalid_grant')) {
                console.error(`❌ Google OAuth token expired or revoked for ${conn.user_email}`);
            } else {
                throw error;
            }
        }
    }

    async generateAIResponse(message, prompt) {
        try {
            if (!this.apiKey) {
                throw new Error('OPENROUTER_API_KEY not set');
            }

            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct:free',
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: `Incoming Email Body:\n${message}\n\nPlease provide a professional response.` }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://pitchers.ai',
                    'X-Title': 'Pitchers AI'
                },
                timeout: 30000
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('❌ AI response generation failed:', error.response?.data || error.message);
            return null;
        }
    }
}

module.exports = EmailAutomationService;
