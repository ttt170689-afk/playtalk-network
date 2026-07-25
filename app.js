const { createClient } = supabase;

const config = window.PLAYTALK_CONFIG || {};
const isConfigured = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('PASTE_');
const client = isConfigured ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null;

const state = {
  authTab: 'login',
  session: null,
  me: null,
  users: [],
  activeUser: null,
  messages: [],
  channel: null,
  lastSeenTimer: null
};

const el = {
  authScreen: document.getElementById('authScreen'),
  chatScreen: document.getElementById('chatScreen'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  registerUsername: document.getElementById('registerUsername'),
  registerDisplayName: document.getElementById('registerDisplayName'),
  registerPassword: document.getElementById('registerPassword'),
  authTabs: [...document.querySelectorAll('.auth-tab')],
  usersList: document.getElementById('usersList'),
  userSearch: document.getElementById('userSearch'),
  emptyState: document.getElementById('emptyState'),
  chatPanel: document.getElementById('chatPanel'),
  chatAvatar: document.getElementById('chatAvatar'),
  chatTitle: document.getElementById('chatTitle'),
  chatStatus: document.getElementById('chatStatus'),
  messagesBox: document.getElementById('messagesBox'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput'),
  logoutBtn: document.getElementById('logoutBtn'),
  meLabel: document.getElementById('meLabel'),
  toast: document.getElementById('toast')
};

function showToast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.remove('show'), 2500);
}

function pseudoEmail(username) {
  return `${username.trim().toLowerCase()}@playtalk.local`;
}

function normalizeUsername(username) {
  return username.trim().toLowerCase().replace(/[^a-z0-9_а-яё.]/gi, '_');
}

function avatarMarkup(user) {
  if (user.avatar_url) {
    return `url(${user.avatar_url}) center/cover`;
  }
  const hue = Math.abs([...user.username].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 360;
  return `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${(hue + 55) % 360} 80% 55%))`;
}

function avatarLetter(user) {
  return (user.display_name || user.username || '?').slice(0, 1).toUpperCase();
}

function formatTime(value) {
  const date = new Date(value);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatLastSeen(value) {
  if (!value) return 'offline';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 20000) return 'в сети';
  if (diff < 60000) return 'был(а) только что';
  if (diff < 3600000) return `был(а) ${Math.floor(diff / 60000)} мин назад`;
  return 'offline';
}

function switchAuthTab(tab) {
  state.authTab = tab;
  el.authTabs.forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
  el.loginForm.classList.toggle('hidden', tab !== 'login');
  el.registerForm.classList.toggle('hidden', tab !== 'register');
}

async function ensureConfigured() {
  if (!client) {
    showToast('Сначала вставь Supabase URL и anon key в config.js');
    return false;
  }
  return true;
}

async function register(event) {
  event.preventDefault();
  if (!(await ensureConfigured())) return;
  const username = normalizeUsername(el.registerUsername.value);
  const displayName = el.registerDisplayName.value.trim();
  const password = el.registerPassword.value;
  if (!username || !displayName || password.length < 6) {
    showToast('Заполни все поля, пароль от 6 символов');
    return;
  }

  const email = pseudoEmail(username);
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { username, display_name: displayName } }
  });
  if (error) {
    showToast(error.message);
    return;
  }

  const userId = data.user?.id;
  if (!userId) {
    showToast('Не удалось создать пользователя');
    return;
  }

  const { error: profileError } = await client.from('profiles').upsert({
    id: userId,
    username,
    display_name: displayName,
    last_seen: new Date().toISOString()
  });

  if (profileError) {
    showToast(profileError.message);
    return;
  }

  showToast('Аккаунт создан, теперь входи');
  switchAuthTab('login');
  el.loginUsername.value = username;
  el.loginPassword.value = password;
}

async function login(event) {
  event.preventDefault();
  if (!(await ensureConfigured())) return;
  const username = normalizeUsername(el.loginUsername.value);
  const password = el.loginPassword.value;
  const email = pseudoEmail(username);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    showToast(error.message);
    return;
  }
}

async function logout() {
  if (!client) return;
  await client.auth.signOut();
  cleanupChannel();
  clearInterval(state.lastSeenTimer);
  state.lastSeenTimer = null;
}

async function loadMe() {
  const userId = state.session?.user?.id;
  if (!userId) return;
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    showToast(error.message);
    return;
  }
  state.me = data;
  el.meLabel.textContent = `@${data.username}`;
}

async function pingLastSeen() {
  if (!state.me) return;
  await client.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', state.me.id);
}

async function loadUsers() {
  if (!state.me) return;
  const { data, error } = await client.from('profiles').select('*').neq('id', state.me.id).order('display_name');
  if (error) {
    showToast(error.message);
    return;
  }
  state.users = data || [];
  renderUsers();
}

function filteredUsers() {
  const q = el.userSearch.value.trim().toLowerCase();
  if (!q) return state.users;
  return state.users.filter(user => {
    return [user.username, user.display_name, user.bio].filter(Boolean).some(value => value.toLowerCase().includes(q));
  });
}

function renderUsers() {
  const users = filteredUsers();
  el.usersList.innerHTML = users.length ? users.map(user => `
    <div class="user-card ${state.activeUser?.id === user.id ? 'active' : ''}" data-user-id="${user.id}">
      <div class="avatar" style="background:${avatarMarkup(user)}">${user.avatar_url ? '' : avatarLetter(user)}</div>
      <div class="user-meta">
        <div class="user-name">${user.display_name || user.username}</div>
        <div class="user-tag">@${user.username} · ${formatLastSeen(user.last_seen)}</div>
      </div>
    </div>
  `).join('') : '<div class="empty-desc" style="padding:20px;">Пока никого нет</div>';

  [...el.usersList.querySelectorAll('.user-card')].forEach(card => {
    card.addEventListener('click', () => openChat(card.dataset.userId));
  });
}

function cleanupChannel() {
  if (state.channel) {
    client.removeChannel(state.channel);
    state.channel = null;
  }
}

async function openChat(userId) {
  const user = state.users.find(item => item.id === userId);
  if (!user) return;
  state.activeUser = user;
  el.emptyState.classList.add('hidden');
  el.chatPanel.classList.remove('hidden');
  el.chatAvatar.style.background = avatarMarkup(user);
  el.chatAvatar.textContent = user.avatar_url ? '' : avatarLetter(user);
  el.chatTitle.textContent = user.display_name || user.username;
  el.chatStatus.textContent = `@${user.username} · ${formatLastSeen(user.last_seen)}`;
  renderUsers();
  await loadMessages();
  subscribeMessages();
}

async function loadMessages() {
  if (!state.me || !state.activeUser) return;
  const { data, error } = await client
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${state.me.id},recipient_id.eq.${state.activeUser.id}),and(sender_id.eq.${state.activeUser.id},recipient_id.eq.${state.me.id})`)
    .order('created_at');

  if (error) {
    showToast(error.message);
    return;
  }
  state.messages = data || [];
  renderMessages();
}

function renderMessages() {
  el.messagesBox.innerHTML = state.messages.length ? state.messages.map(message => {
    const mine = message.sender_id === state.me.id;
    return `
      <div class="message-row ${mine ? 'me' : 'other'}">
        <div class="message-bubble">
          <div>${escapeHtml(message.body)}</div>
          <div class="message-meta">${formatTime(message.created_at)}</div>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty-desc">Пока сообщений нет</div>';
  el.messagesBox.scrollTop = el.messagesBox.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function subscribeMessages() {
  cleanupChannel();
  if (!state.me || !state.activeUser) return;
  state.channel = client
    .channel(`chat-${state.me.id}-${state.activeUser.id}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, payload => {
      const message = payload.new;
      const belongs = (
        (message.sender_id === state.me.id && message.recipient_id === state.activeUser.id) ||
        (message.sender_id === state.activeUser.id && message.recipient_id === state.me.id)
      );
      if (!belongs) return;
      if (!state.messages.find(item => item.id === message.id)) {
        state.messages.push(message);
        renderMessages();
      }
    })
    .subscribe();
}

async function sendMessage(event) {
  event.preventDefault();
  if (!state.me || !state.activeUser) return;
  const body = el.messageInput.value.trim();
  if (!body) return;
  el.messageInput.value = '';
  const { error } = await client.from('messages').insert({
    sender_id: state.me.id,
    recipient_id: state.activeUser.id,
    body
  });
  if (error) {
    showToast(error.message);
  }
}

async function bootstrap() {
  if (!client) {
    showToast('Открой config.js и вставь Supabase URL/anon key');
    return;
  }

  const { data } = await client.auth.getSession();
  state.session = data.session;
  updateScreen();

  client.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    updateScreen();
  });
}

async function updateScreen() {
  if (!state.session) {
    el.authScreen.classList.remove('hidden');
    el.chatScreen.classList.add('hidden');
    state.me = null;
    state.users = [];
    state.activeUser = null;
    state.messages = [];
    cleanupChannel();
    clearInterval(state.lastSeenTimer);
    state.lastSeenTimer = null;
    return;
  }

  el.authScreen.classList.add('hidden');
  el.chatScreen.classList.remove('hidden');
  await loadMe();
  await pingLastSeen();
  await loadUsers();
  state.lastSeenTimer = setInterval(async () => {
    await pingLastSeen();
    await loadUsers();
    if (state.activeUser) {
      const fresh = state.users.find(user => user.id === state.activeUser.id);
      if (fresh) {
        state.activeUser = fresh;
        el.chatStatus.textContent = `@${fresh.username} · ${formatLastSeen(fresh.last_seen)}`;
      }
    }
  }, 10000);
}

el.authTabs.forEach(button => {
  button.addEventListener('click', () => switchAuthTab(button.dataset.authTab));
});
el.loginForm.addEventListener('submit', login);
el.registerForm.addEventListener('submit', register);
el.logoutBtn.addEventListener('click', logout);
el.userSearch.addEventListener('input', renderUsers);
el.messageForm.addEventListener('submit', sendMessage);

bootstrap();
