/**
 * MyState Cross-Site Agent Chat Widget — Agent API Edition
 * ========================================================
 * Custom chat UI powered by the Agentforce Agent API (REST) for true
 * cross-site conversation continuity. When James clicks from the MyState
 * portal to an external form, the agent remembers everything.
 *
 * Architecture:
 *   Browser  →  Proxy Server  →  Salesforce Agent API
 *              (holds OAuth)     (same sessionId = same conversation)
 *
 * Usage: Add this single <script> tag to your page:
 *   <script src="chat-widget.js"></script>
 *
 * The widget automatically:
 *   1. Reads URL params (sessionId, agentId, chatHistory, returnUrl, etc.)
 *   2. Renders the prior portal conversation as real chat messages
 *   3. Sends new messages via the proxy → Agent API (same session)
 *   4. Auto-fills form fields with user context from the portal
 *   5. Shows a "Return to MyState Portal" banner
 */
(function () {
    'use strict';

    // ---- PROXY CONFIGURATION ----
    // Change this to your deployed proxy URL
    const PROXY_URL = window.MYSTATE_PROXY_URL || 'https://mystate-agent-proxy.onrender.com';

    // ---- BRAND COLORS (matches MyState portal design system) ----
    const BRAND = {
        primary: '#032D60',
        accent: '#0176D3',
        accentLight: '#1B96FF',
        white: '#FFFFFF',
        bg: '#F4F6F9',
        border: '#E5E5E5',
        textPrimary: '#032D60',
        textSecondary: '#706E6B',
        gradient: 'linear-gradient(135deg, #032D60 0%, #0176D3 100%)',
        success: '#2E844A',
        agentBubble: '#E8F4FD',
        userBubble: '#032D60'
    };

    // ---- URL PARAMETER PARSING ----
    function getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            sessionId:       params.get('sessionId') || null,
            agentId:         params.get('agentId') || null,
            returnUrl:       params.get('returnUrl') || null,
            chatHistory:     params.get('chatHistory') || null,
            firstName:       params.get('fname') || '',
            lastName:        params.get('lname') || '',
            email:           params.get('email') || '',
            phone:           params.get('phone') || '',
            ssoId:           params.get('sso_id') || '',
            county:          params.get('county') || '',
            farmName:        params.get('farmName') || '',
            farmReg:         params.get('farmReg') || '',
            acreage:         params.get('acreage') || '',
            crops:           params.get('crops') || '',
            acresAffected:   params.get('acresAffected') || '',
            cropLoss:        params.get('cropLoss') || '',
            financialImpact: params.get('financialImpact') || ''
        };
    }

    function decodeChatHistory(encoded) {
        if (!encoded) return [];
        try {
            const decoded = decodeURIComponent(atob(encoded));
            return JSON.parse(decoded);
        } catch (e) {
            return [];
        }
    }

    // ---- MAIN WIDGET CLASS ----
    class MyStateCrossWidget {
        constructor() {
            this.params = getUrlParams();
            this.sessionId = this.params.sessionId;
            this.agentId = this.params.agentId;
            this.isChatOpen = false;
            this.isSending = false;
            this.messages = [];

            this._injectStyles();
            this._autoFillFormFields();
            this._createContextBanner();
            this._createChatWidget();
            this._loadPriorConversation();

            // Auto-open chat if we have a session (came from portal)
            if (this.sessionId) {
                setTimeout(() => this._toggleChat(), 1500);
            }
        }

        _injectStyles() {
            const style = document.createElement('style');
            style.id = 'mystate-agent-widget-styles';
            style.textContent = `
                #mystate-return-banner {
                    position: fixed; top: 0; left: 0; right: 0;
                    background: ${BRAND.gradient};
                    color: white;
                    display: flex; align-items: center; justify-content: center; gap: 12px;
                    padding: 10px 20px;
                    font-family: 'Salesforce Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 14px; font-weight: 500;
                    z-index: 99998;
                    box-shadow: 0 2px 12px rgba(3,45,96,0.2);
                }
                #mystate-return-banner a {
                    color: white; text-decoration: none;
                    background: rgba(255,255,255,0.2);
                    padding: 5px 14px; border-radius: 20px;
                    font-size: 13px; font-weight: 600;
                    transition: background 0.15s;
                }
                #mystate-return-banner a:hover { background: rgba(255,255,255,0.35); }
                #mystate-return-banner .banner-close {
                    position: absolute; right: 12px;
                    background: transparent; border: none; cursor: pointer;
                    padding: 4px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    transition: background 0.15s;
                }
                #mystate-return-banner .banner-close:hover { background: rgba(255,255,255,0.15); }
                #mystate-return-banner .banner-close svg { width: 16px; height: 16px; fill: white; }
                body.mystate-has-banner { padding-top: 44px !important; }

                #mystate-chat-fab {
                    position: fixed; bottom: 24px; right: 24px;
                    width: 60px; height: 60px; border-radius: 50%;
                    background: ${BRAND.gradient};
                    border: none; cursor: pointer;
                    box-shadow: 0 4px 20px rgba(3,45,96,0.35);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 99999;
                    transition: all 0.25s ease;
                }
                #mystate-chat-fab:hover {
                    transform: scale(1.08);
                    box-shadow: 0 6px 28px rgba(3,45,96,0.45);
                }
                #mystate-chat-fab svg { width: 28px; height: 28px; fill: white; }
                #mystate-chat-fab.hidden { display: none; }

                #mystate-chat-fab .continuity-dot {
                    position: absolute; top: -2px; right: -2px;
                    width: 16px; height: 16px; border-radius: 50%;
                    background: ${BRAND.success};
                    border: 2px solid white;
                    animation: mystate-pulse 2s infinite;
                }
                @keyframes mystate-pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.2); opacity: 0.8; }
                }

                #mystate-chat-panel {
                    position: fixed; bottom: 24px; right: 24px;
                    width: 380px; height: 560px;
                    max-height: calc(100vh - 80px);
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 8px 40px rgba(3,45,96,0.2);
                    z-index: 100000;
                    display: none; flex-direction: column;
                    overflow: hidden;
                    font-family: 'Salesforce Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    animation: mystate-panel-in 0.3s ease-out;
                }
                #mystate-chat-panel.open { display: flex; }
                @keyframes mystate-panel-in {
                    from { opacity: 0; transform: translateY(20px) scale(0.95); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }

                .mystate-chat-header {
                    background: ${BRAND.gradient};
                    padding: 14px 16px;
                    display: flex; align-items: center; justify-content: space-between;
                    flex-shrink: 0;
                }
                .mystate-chat-header-left {
                    display: flex; align-items: center; gap: 10px;
                }
                .mystate-chat-avatar {
                    width: 36px; height: 36px; border-radius: 50%;
                    background: rgba(255,255,255,0.2);
                    display: flex; align-items: center; justify-content: center;
                }
                .mystate-chat-avatar svg { width: 20px; height: 20px; fill: white; }
                .mystate-chat-header-title {
                    color: white; font-size: 15px; font-weight: 600;
                }
                .mystate-chat-header-status {
                    color: rgba(255,255,255,0.75); font-size: 12px;
                    display: flex; align-items: center; gap: 5px;
                }
                .mystate-chat-header-status .status-dot {
                    width: 7px; height: 7px; border-radius: 50%;
                    background: #4BCA81; display: inline-block;
                }
                .mystate-close-btn {
                    background: transparent; border: none; cursor: pointer;
                    padding: 6px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    transition: background 0.15s;
                }
                .mystate-close-btn:hover { background: rgba(255,255,255,0.15); }
                .mystate-close-btn svg { width: 18px; height: 18px; fill: white; }

                .mystate-continuity-banner {
                    background: #EAF5EA; border-bottom: 1px solid #C8E6C9;
                    padding: 8px 14px;
                    display: flex; align-items: center; gap: 8px;
                    font-size: 12px; color: #1B5E20;
                    flex-shrink: 0;
                }
                .mystate-continuity-banner svg { width: 14px; height: 14px; fill: #2E844A; flex-shrink: 0; }

                .mystate-chat-messages {
                    flex: 1; overflow-y: auto;
                    padding: 16px; display: flex;
                    flex-direction: column; gap: 10px;
                    background: ${BRAND.bg};
                }

                .mystate-msg { display: flex; max-width: 85%; }
                .mystate-msg.agent { align-self: flex-start; }
                .mystate-msg.user { align-self: flex-end; }
                .mystate-bubble {
                    padding: 10px 14px; border-radius: 14px;
                    font-size: 14px; line-height: 1.5; word-break: break-word;
                }
                .mystate-msg.agent .mystate-bubble {
                    background: white; border: 1px solid ${BRAND.border};
                    border-bottom-left-radius: 4px; color: ${BRAND.textPrimary};
                }
                .mystate-msg.user .mystate-bubble {
                    background: ${BRAND.userBubble}; color: white;
                    border-bottom-right-radius: 4px;
                }
                .mystate-msg-time {
                    font-size: 10px; color: ${BRAND.textSecondary};
                    margin-top: 3px; padding: 0 4px;
                }
                .mystate-msg.user .mystate-msg-time { text-align: right; }

                .mystate-divider {
                    display: flex; align-items: center; gap: 10px;
                    margin: 6px 0; font-size: 11px; color: ${BRAND.textSecondary};
                }
                .mystate-divider::before, .mystate-divider::after {
                    content: ''; flex: 1; height: 1px; background: ${BRAND.border};
                }

                .mystate-typing {
                    display: flex; align-items: center; gap: 4px;
                    padding: 10px 14px; background: white;
                    border: 1px solid ${BRAND.border};
                    border-radius: 14px; border-bottom-left-radius: 4px;
                    align-self: flex-start;
                }
                .mystate-typing-dot {
                    width: 7px; height: 7px; border-radius: 50%;
                    background: ${BRAND.accent};
                    animation: mystate-typing-bounce 1.4s infinite ease-in-out both;
                }
                .mystate-typing-dot:nth-child(1) { animation-delay: 0s; }
                .mystate-typing-dot:nth-child(2) { animation-delay: 0.16s; }
                .mystate-typing-dot:nth-child(3) { animation-delay: 0.32s; }
                @keyframes mystate-typing-bounce {
                    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
                    40% { transform: scale(1); opacity: 1; }
                }

                .mystate-chat-input-area {
                    padding: 12px; border-top: 1px solid ${BRAND.border};
                    display: flex; gap: 8px; align-items: center;
                    background: white; flex-shrink: 0;
                }
                .mystate-chat-input {
                    flex: 1; border: 1px solid ${BRAND.border};
                    border-radius: 24px; padding: 10px 16px;
                    font-size: 14px; outline: none;
                    font-family: inherit;
                    transition: border-color 0.2s;
                }
                .mystate-chat-input:focus { border-color: ${BRAND.accent}; }
                .mystate-chat-input:disabled { opacity: 0.5; }
                .mystate-send-btn {
                    width: 40px; height: 40px; border-radius: 50%;
                    background: ${BRAND.accent}; border: none;
                    cursor: pointer; display: flex;
                    align-items: center; justify-content: center;
                    transition: all 0.2s;
                    flex-shrink: 0;
                }
                .mystate-send-btn:hover { background: ${BRAND.accentLight}; transform: scale(1.05); }
                .mystate-send-btn:disabled { opacity: 0.4; cursor: default; transform: none; }
                .mystate-send-btn svg { width: 18px; height: 18px; fill: white; }

                @media (max-width: 480px) {
                    #mystate-chat-panel {
                        width: 100vw; height: 100vh;
                        bottom: 0; right: 0; border-radius: 0;
                        max-height: 100vh;
                    }
                    #mystate-return-banner { font-size: 12px; padding: 8px 12px; }
                }
            `;
            document.head.appendChild(style);
        }

        _autoFillFormFields() {
            if (!this.params.firstName && !this.params.lastName && !this.params.email) return;

            const fill = () => {
                // Regular text/number/email/tel inputs
                const fieldMap = {
                    'fname':           this.params.firstName,
                    'first_name':      this.params.firstName,
                    'firstName':       this.params.firstName,
                    'lname':           this.params.lastName,
                    'last_name':       this.params.lastName,
                    'lastName':        this.params.lastName,
                    'email':           this.params.email,
                    'phone':           this.params.phone,
                    'sso_id':          this.params.ssoId,
                    'sso_ref':         this.params.ssoId,
                    'referenceId':     this.params.ssoId,
                    'farmName':        this.params.farmName,
                    'farmReg':         this.params.farmReg,
                    'acreage':         this.params.acreage,
                    'crops':           this.params.crops,
                    'acresAffected':   this.params.acresAffected,
                    'financialImpact': this.params.financialImpact
                };

                for (const [name, value] of Object.entries(fieldMap)) {
                    if (!value) continue;
                    const el = document.querySelector(`input[name="${name}"], input[id="${name}"]`);
                    if (el && !el.value) {
                        el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.style.boxShadow = '0 0 0 2px rgba(1,118,211,0.3)';
                        el.style.transition = 'box-shadow 0.3s ease';
                    }
                }

                // Select (dropdown) fields
                const selectMap = {
                    'county':   (this.params.county || '').toLowerCase(),
                    'cropLoss': this.params.cropLoss
                };

                for (const [name, value] of Object.entries(selectMap)) {
                    if (!value) continue;
                    const el = document.querySelector(`select[name="${name}"]`);
                    if (el && !el.value) {
                        el.value = value;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.style.boxShadow = '0 0 0 2px rgba(1,118,211,0.3)';
                        el.style.transition = 'box-shadow 0.3s ease';
                    }
                }
            };

            fill();
            setTimeout(fill, 1000);
            setTimeout(fill, 3000);
        }

        _createContextBanner() {
            if (!this.params.returnUrl) return;

            const banner = document.createElement('div');
            banner.id = 'mystate-return-banner';
            banner.innerHTML = `
                <span style="display:flex;align-items:center">
                    <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:white;margin-right:8px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                </span>
                <span>You came here from the <strong>MyState Portal</strong>. Your assistant is continuing the conversation.</span>
                <a href="${this.params.returnUrl}">\u2190 Return to Portal</a>
            `;

            const closeBtn = document.createElement('button');
            closeBtn.className = 'banner-close';
            closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
            closeBtn.addEventListener('click', () => {
                banner.remove();
                document.body.classList.remove('mystate-has-banner');
            });
            banner.appendChild(closeBtn);

            document.body.insertBefore(banner, document.body.firstChild);
            document.body.classList.add('mystate-has-banner');
        }

        _createChatWidget() {
            this.fab = document.createElement('button');
            this.fab.id = 'mystate-chat-fab';
            this.fab.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
                ${this.sessionId ? '<span class="continuity-dot"></span>' : ''}
            `;
            this.fab.title = this.sessionId
                ? 'Continue your conversation with MyState Assistant'
                : 'Chat with MyState Assistant';
            this.fab.addEventListener('click', () => this._toggleChat());
            document.body.appendChild(this.fab);

            this.panel = document.createElement('div');
            this.panel.id = 'mystate-chat-panel';

            const header = document.createElement('div');
            header.className = 'mystate-chat-header';
            header.innerHTML = `
                <div class="mystate-chat-header-left">
                    <div class="mystate-chat-avatar">
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93s3.05-7.44 7-7.93v15.86zm2-15.86c3.95.49 7 3.85 7 7.93s-3.05 7.44-7 7.93V4.07z"/></svg>
                    </div>
                    <div>
                        <div class="mystate-chat-header-title">MyState Assistant</div>
                        <div class="mystate-chat-header-status">
                            <span class="status-dot"></span>
                            ${this.sessionId ? 'Continuing conversation' : 'Online'}
                        </div>
                    </div>
                </div>
            `;
            const closeBtn = document.createElement('button');
            closeBtn.className = 'mystate-close-btn';
            closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
            closeBtn.addEventListener('click', () => this._toggleChat());
            header.appendChild(closeBtn);
            this.panel.appendChild(header);

            if (this.sessionId) {
                const contBanner = document.createElement('div');
                contBanner.className = 'mystate-continuity-banner';
                contBanner.innerHTML = `
                    <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    <span>Conversation continued from MyState Portal</span>
                `;
                this.panel.appendChild(contBanner);
            }

            this.messagesEl = document.createElement('div');
            this.messagesEl.className = 'mystate-chat-messages';
            this.panel.appendChild(this.messagesEl);

            const inputArea = document.createElement('div');
            inputArea.className = 'mystate-chat-input-area';

            this.inputEl = document.createElement('input');
            this.inputEl.type = 'text';
            this.inputEl.className = 'mystate-chat-input';
            this.inputEl.placeholder = 'Type your question...';
            this.inputEl.addEventListener('keyup', (e) => {
                if (e.key === 'Enter' && this.inputEl.value.trim() && !this.isSending) {
                    this._sendMessage();
                }
            });
            inputArea.appendChild(this.inputEl);

            this.sendBtn = document.createElement('button');
            this.sendBtn.className = 'mystate-send-btn';
            this.sendBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
            this.sendBtn.addEventListener('click', () => this._sendMessage());
            inputArea.appendChild(this.sendBtn);

            this.panel.appendChild(inputArea);
            document.body.appendChild(this.panel);
        }

        _loadPriorConversation() {
            const history = decodeChatHistory(this.params.chatHistory);
            if (history.length === 0) return;

            history.forEach(item => {
                this._addMessage(item.t, item.r === 'u' ? 'user' : 'agent', false);
            });

            const divider = document.createElement('div');
            divider.className = 'mystate-divider';
            divider.textContent = 'Continued on this page';
            this.messagesEl.appendChild(divider);
        }

        async _sendMessage() {
            const text = this.inputEl.value.trim();
            if (!text || this.isSending) return;

            this.inputEl.value = '';
            this.isSending = true;
            this.inputEl.disabled = true;
            this.sendBtn.disabled = true;

            this._addMessage(text, 'user');
            const typingEl = this._showTyping();

            try {
                const response = await fetch(`${PROXY_URL}/api/agent/message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: this.sessionId,
                        message: text,
                        agentId: this.agentId
                    })
                });

                if (typingEl && typingEl.parentNode) {
                    typingEl.parentNode.removeChild(typingEl);
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `HTTP ${response.status}`);
                }

                const data = await response.json();

                if (data._newSessionId) {
                    this.sessionId = data._newSessionId;
                }

                const agentText = this._extractResponse(data);
                if (agentText) {
                    this._addMessage(agentText, 'agent');
                } else {
                    this._addMessage('I\'m here to help. Could you rephrase your question?', 'agent');
                }
            } catch (err) {
                if (typingEl && typingEl.parentNode) {
                    typingEl.parentNode.removeChild(typingEl);
                }
                this._addMessage(
                    'I\'m having trouble connecting right now. Please try again in a moment.',
                    'agent'
                );
            }

            this.isSending = false;
            this.inputEl.disabled = false;
            this.sendBtn.disabled = false;
            this.inputEl.focus();
        }

        _extractResponse(data) {
            if (data && data.messages && data.messages.length > 0) {
                const agentMsgs = data.messages.filter(
                    m => m.type === 'Inform' || m.type === 'Text'
                );
                if (agentMsgs.length > 0) {
                    return agentMsgs.map(m => m.message || m.text || m.content).join('\n');
                }
            }
            if (data && data.response) return data.response;
            if (data && data.message && typeof data.message === 'string') return data.message;
            if (typeof data === 'string') return data;
            return null;
        }

        _addMessage(text, role, scroll = true) {
            const wrapper = document.createElement('div');
            wrapper.className = `mystate-msg ${role}`;

            const bubble = document.createElement('div');
            bubble.className = 'mystate-bubble';
            bubble.textContent = text;
            wrapper.appendChild(bubble);

            this.messagesEl.appendChild(wrapper);
            this.messages.push({ text, role });

            if (scroll) {
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            }
        }

        _showTyping() {
            const typing = document.createElement('div');
            typing.className = 'mystate-typing';
            typing.innerHTML = `
                <span class="mystate-typing-dot"></span>
                <span class="mystate-typing-dot"></span>
                <span class="mystate-typing-dot"></span>
            `;
            this.messagesEl.appendChild(typing);
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            return typing;
        }

        _toggleChat() {
            this.isChatOpen = !this.isChatOpen;
            this.panel.classList.toggle('open', this.isChatOpen);
            this.fab.classList.toggle('hidden', this.isChatOpen);

            if (this.isChatOpen) {
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
                setTimeout(() => this.inputEl.focus(), 300);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new MyStateCrossWidget());
    } else {
        new MyStateCrossWidget();
    }
})();
