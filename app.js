const TAX_RATE = 0.05;
const STORAGE_KEY = 'corner-table-pos-v1';
const CLOUD_SYNC_KEY = 'corner-pos-sync-config-v1';
const ADMIN_PIN = 'synergy2026';
const ROLE_LABELS = { waiter: 'Waiter', kitchen: 'Kitchen', admin: 'Administrator' };
const DEFAULT_MENU = [
  { id: 1, name: 'Crispy chicken sandwich', category: 'Mains', price: 14.5, stock: 24, station: 'Grill', emoji: '🍔' },
  { id: 2, name: 'Mushroom rigatoni', category: 'Mains', price: 18, stock: 18, station: 'Hot line', emoji: '🍝' },
  { id: 3, name: 'Market salad', category: 'Mains', price: 13, stock: 20, station: 'Cold line', emoji: '🥗' },
  { id: 4, name: 'Fish & chips', category: 'Mains', price: 19.5, stock: 12, station: 'Fryer', emoji: '🐟' },
  { id: 5, name: 'Roasted tomato soup', category: 'Starters', price: 8, stock: 15, station: 'Hot line', emoji: '🍲' },
  { id: 6, name: 'Crispy calamari', category: 'Starters', price: 12, stock: 10, station: 'Fryer', emoji: '🦑' },
  { id: 7, name: 'House fries', category: 'Sides', price: 6, stock: 30, station: 'Fryer', emoji: '🍟' },
  { id: 8, name: 'Garlic bread', category: 'Sides', price: 5.5, stock: 22, station: 'Hot line', emoji: '🥖' },
  { id: 9, name: 'Iced tea', category: 'Drinks', price: 4, stock: 40, station: 'Bar', emoji: '🥤' },
  { id: 10, name: 'Sparkling lemonade', category: 'Drinks', price: 5, stock: 28, station: 'Bar', emoji: '🍋' },
  { id: 11, name: 'Chocolate tart', category: 'Desserts', price: 8.5, stock: 14, station: 'Dessert', emoji: '🍰' },
  { id: 12, name: 'Vanilla bean panna cotta', category: 'Desserts', price: 7.5, stock: 9, station: 'Dessert', emoji: '🍮' }
];
const TABLES = Array.from({ length: 12 }, (_, index) => index + 1);
const $ = id => document.getElementById(id);
const money = value => `$${Number(value || 0).toFixed(2)}`;
const readState = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
};
const readSyncConfig = () => {
  let savedConfig = { enabled: false, url: '', anonKey: '' };
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      savedConfig = {
        enabled: Boolean(parsed.enabled),
        url: typeof parsed.url === 'string' ? parsed.url.trim() : '',
        anonKey: typeof parsed.anonKey === 'string' ? parsed.anonKey.trim() : ''
      };
    }
  } catch {}
  const sharedConfig = window.SYNERGY_SUPABASE_CONFIG || {};
  const url = typeof sharedConfig.url === 'string' ? sharedConfig.url.trim() : '';
  const anonKey = typeof sharedConfig.anonKey === 'string' ? sharedConfig.anonKey.trim() : '';
  if (url && anonKey) return { enabled: true, url, anonKey };
  return savedConfig;
};
const saveSyncConfig = config => {
  localStorage.setItem(CLOUD_SYNC_KEY, JSON.stringify({
    enabled: Boolean(config.enabled),
    url: typeof config.url === 'string' ? config.url.trim() : '',
    anonKey: typeof config.anonKey === 'string' ? config.anonKey.trim() : ''
  }));
};
let syncConfig = readSyncConfig();
let cloudSyncClient = null;
let cloudSyncChannel = null;
let cloudSyncReady = false;
let lastCloudUpdate = 0;
let cloudSyncPromise = Promise.resolve();
let cloudSyncTimer = null;
const saved = readState();
let menu = Array.isArray(saved.menu) ? saved.menu : DEFAULT_MENU;
let orders = Array.isArray(saved.orders) ? saved.orders : [];
let companyName = !saved.companyName || saved.companyName === 'Corner Table' ? 'Synergy' : saved.companyName;
let companyLogo = saved.companyLogo || '';
let nextOrderNumber = saved.nextOrderNumber || 2401;
const savedStaff = saved.staffAccounts || {};
const loadStaffRoster = (staffRole, fallbackName, fallbackPin) => {
  const stored = savedStaff[staffRole];
  const roster = Array.isArray(stored) ? stored : stored && typeof stored === 'object' ? [{ ...stored, id: `${staffRole}-default` }] : [{ id: `${staffRole}-default`, name: fallbackName, pin: fallbackPin, enabled: true }];
  return roster.map((profile, index) => ({
    id: String(profile.id || `${staffRole}-${index + 1}`),
    name: typeof profile.name === 'string' ? profile.name : fallbackName,
    pin: typeof profile.pin === 'string' ? profile.pin : fallbackPin,
    enabled: profile.enabled !== false
  }));
};
let staffAccounts = {
  waiter: loadStaffRoster('waiter', 'Waiter', '1234'),
  kitchen: loadStaffRoster('kitchen', 'Kitchen', '2345')
};
let staffSessions = Array.isArray(saved.staffSessions) ? saved.staffSessions : [];
let staffActivity = Array.isArray(saved.staffActivity) ? saved.staffActivity : [];
let role = '';
let staffName = '';
let activeSessionId = '';
let activeView = '';
let selectedTable = null;
let waiterDraft = [];
let counterDraft = [];
let activeCategory = 'All';
let kitchenFilter = 'active';
let paymentOrderId = null;
let paymentSource = '';
let paymentMethod = 'Card';
let lastReceipt = null;
let toastTimer;
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  if ($('install-app')) $('install-app').hidden = true;
  toast('Synergy POS installed.');
});

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ menu, orders, nextOrderNumber, companyName, companyLogo, staffAccounts, staffSessions, staffActivity }));
  if (cloudSyncReady) {
    clearTimeout(cloudSyncTimer);
    setCloudSyncStatus('Saving changes to Supabase…', 'pending');
    cloudSyncTimer = setTimeout(() => { void syncToCloud(); }, 300);
  }
}
function normalizeMenuItem(item) {
  return {
    id: Number(item.id),
    name: item.name || 'Menu item',
    category: item.category || 'Mains',
    station: item.station || 'Kitchen',
    price: Number(item.price || 0),
    stock: Number(item.stock || 0),
    emoji: item.emoji || '🍽️',
    image: typeof item.image === 'string' ? item.image : ''
  };
}
function normalizeOrder(order) {
  return {
    ...order,
    id: order.id || crypto.randomUUID(),
    number: Number(order.number || nextOrderNumber),
    table: order.table_number ?? order.table ?? null,
    type: order.type || 'Dine-in',
    guests: Number(order.guests || 1),
    status: order.status || 'new',
    items: Array.isArray(order.items) ? order.items : [],
    staff: order.staff || staffName,
    createdAt: order.createdAt || order.created_at || timestamp(),
    createdISO: order.createdISO || order.created_at || new Date().toISOString(),
    sentAt: order.sentAt || order.sent_at || '',
    paidAt: order.paidAt || order.paid_at || '',
    paidAtISO: order.paidAtISO || order.paid_at || '',
    payment: order.payment || '',
    subtotal: Number(order.subtotal || 0),
    tax: Number(order.tax || 0),
    total: Number(order.total || 0),
    staffPaid: order.staffPaid || order.staff_paid || ''
  };
}
async function syncToCloud() {
  if (!cloudSyncClient || !cloudSyncReady) return;
  const now = new Date().toISOString();
  const snapshot = { menu, orders, nextOrderNumber, companyName, companyLogo, staffAccounts, staffSessions, staffActivity };
  const stateRow = { id: 'restaurant', state: snapshot, updated_at: now };
  cloudSyncPromise = cloudSyncPromise.catch(() => {}).then(async () => {
    const menuRows = menu.map(item => ({
      id: Number(item.id),
      name: item.name,
      category: item.category,
      station: item.station,
      price: Number(item.price || 0),
      stock: Number(item.stock || 0),
      emoji: item.emoji || '🍽️',
      image: item.image || '',
      created_at: now
    }));

    const orderRows = orders.map(order => ({
      id: order.id,
      number: Number(order.number || nextOrderNumber),
      table_number: order.table ?? null,
      type: order.type || 'Dine-in',
      guests: Number(order.guests || 1),
      status: order.status || 'new',
      items: Array.isArray(order.items) ? order.items : [],
      staff: order.staff || '',
      created_at: order.createdISO || new Date().toISOString(),
      updated_at: now,
      sent_at: order.sentAt || '',
      paid_at: order.paidAtISO || '',
      payment: order.payment || '',
      subtotal: Number(order.subtotal || 0),
      tax: Number(order.tax || 0),
      total: Number(order.total || 0)
    }));

    const settingsRow = {
      id: 'restaurant',
      company_name: companyName,
      company_logo: companyLogo,
      updated_at: now
    };

    const results = await Promise.all([
      cloudSyncClient.from('pos_state').upsert(stateRow, { onConflict: 'id' }),
      cloudSyncClient.from('menu').upsert(menuRows, { onConflict: 'id' }),
      cloudSyncClient.from('orders').upsert(orderRows, { onConflict: 'id' }),
      cloudSyncClient.from('settings').upsert(settingsRow, { onConflict: 'id' })
    ]);
    const failedResult = results.find(result => result.error);
    if (failedResult) throw failedResult.error;
    lastCloudUpdate = Date.now();
    setCloudSyncStatus(`All POS data saved to Supabase · ${new Date(lastCloudUpdate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'success');
  }).catch(error => {
    console.warn('Cloud sync failed:', error);
    setCloudSyncStatus(`Supabase sync failed: ${error.message || 'Check table setup and access policies.'}`, 'error');
  });
  return cloudSyncPromise;
}
async function hydrateFromCloud() {
  if (!cloudSyncClient || !cloudSyncReady) return;
  try {
    const { data: stateRow, error: stateError } = await cloudSyncClient.from('pos_state').select('state').eq('id', 'restaurant').maybeSingle();
    if (!stateError && stateRow?.state) {
      const cloudState = stateRow.state;
      if (Array.isArray(cloudState.menu)) menu = cloudState.menu.map(normalizeMenuItem);
      if (Array.isArray(cloudState.orders)) orders = cloudState.orders.map(normalizeOrder);
      if (Number.isFinite(Number(cloudState.nextOrderNumber))) nextOrderNumber = Number(cloudState.nextOrderNumber);
      if (typeof cloudState.companyName === 'string') companyName = cloudState.companyName;
      if (typeof cloudState.companyLogo === 'string') companyLogo = cloudState.companyLogo;
      if (cloudState.staffAccounts && typeof cloudState.staffAccounts === 'object') {
        for (const staffRole of ['waiter', 'kitchen']) {
          if (Array.isArray(cloudState.staffAccounts[staffRole])) {
            staffAccounts[staffRole] = cloudState.staffAccounts[staffRole].map((profile, index) => ({
              id: String(profile.id || `${staffRole}-${index + 1}`),
              name: String(profile.name || staffRole),
              pin: String(profile.pin || ''),
              enabled: profile.enabled !== false
            }));
          }
        }
      }
      if (Array.isArray(cloudState.staffSessions)) staffSessions = cloudState.staffSessions;
      if (Array.isArray(cloudState.staffActivity)) staffActivity = cloudState.staffActivity;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ menu, orders, nextOrderNumber, companyName, companyLogo, staffAccounts, staffSessions, staffActivity }));
      applyBranding();
      renderAll();
      setCloudSyncStatus('Connected · all POS data loaded from Supabase.', 'success');
      return;
    }
    if (stateError && stateError.code !== '42P01' && stateError.code !== 'PGRST205') throw stateError;

    const [{ data: menuData, error: menuError }, { data: orderData, error: orderError }, { data: settingsData, error: settingsError }] = await Promise.all([
      cloudSyncClient.from('menu').select('*'),
      cloudSyncClient.from('orders').select('*').order('created_at', { ascending: true }),
      cloudSyncClient.from('settings').select('*').eq('id', 'restaurant').maybeSingle()
    ]);

    if (menuError) throw menuError;
    if (orderError) throw orderError;
    if (settingsError) throw settingsError;

    if (Array.isArray(menuData) && menuData.length) {
      menu = menuData.map(normalizeMenuItem);
    }
    if (Array.isArray(orderData) && orderData.length) {
      orders = orderData.map(normalizeOrder);
      if (orders.length) {
        nextOrderNumber = Math.max(...orders.map(order => Number(order.number || 0))) + 1;
      }
    }
    if (settingsData) {
      companyName = settingsData.company_name || companyName;
      companyLogo = settingsData.company_logo || companyLogo;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ menu, orders, nextOrderNumber, companyName, companyLogo, staffAccounts, staffSessions, staffActivity }));
    renderAll();
    setCloudSyncStatus('Connected · legacy POS data loaded. Saving a complete snapshot…', 'pending');
    await syncToCloud();
  } catch (error) {
    console.warn('Unable to hydrate state from cloud sync:', error);
    setCloudSyncStatus(`Could not load Supabase data: ${error.message || 'Check table setup and access policies.'}`, 'error');
  }
}
function setCloudSyncStatus(message, state) {
  const status = $('cloud-sync-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}
function startCloudSync() {
  if (!syncConfig.enabled || !syncConfig.url || !syncConfig.anonKey || typeof window.supabase === 'undefined') {
    cloudSyncClient = null;
    cloudSyncChannel = null;
    cloudSyncReady = false;
    const message = !syncConfig.enabled
      ? 'Cloud sync is off. Enable it and save valid Supabase credentials to auto-save POS data.'
      : !syncConfig.url || !syncConfig.anonKey
        ? 'Sync is enabled, but the Supabase URL or anon key is missing.'
        : 'Supabase client could not load. Check your network connection and reload the POS.';
    setCloudSyncStatus(message, 'idle');
    return;
  }

  cloudSyncClient = window.supabase.createClient(syncConfig.url, syncConfig.anonKey);
  cloudSyncReady = true;

  if (cloudSyncChannel) {
    cloudSyncChannel.unsubscribe();
    cloudSyncChannel = null;
  }

  cloudSyncChannel = cloudSyncClient.channel('restaurant-live-updates');
  cloudSyncChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, () => { void hydrateFromCloud(); });
  cloudSyncChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { void hydrateFromCloud(); });
  cloudSyncChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => { void hydrateFromCloud(); });
  cloudSyncChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'pos_state' }, () => { void hydrateFromCloud(); });
  cloudSyncChannel.subscribe();
}
function stopCloudSync() {
  if (cloudSyncChannel) {
    cloudSyncChannel.unsubscribe();
    cloudSyncChannel = null;
  }
  cloudSyncClient = null;
  cloudSyncReady = false;
}
function refreshIcons() { window.lucide?.createIcons(); }
function applyBranding() {
  document.querySelectorAll('.company-name').forEach(node => { node.textContent = companyName; });
  $('login-company-name').textContent = companyName;
  $('sidebar-company-name').textContent = companyName;
  $('store-company-name').textContent = companyName;
  $('breadcrumb-company-name').textContent = companyName;
  document.title = companyName === 'Synergy' ? 'Synergy POS' : `${companyName} | Synergy POS`;
  document.querySelectorAll('.company-logo').forEach(image => {
    image.hidden = !companyLogo;
    image.src = companyLogo || '';
    image.closest('.brand-mark').querySelector('.brand-fallback').hidden = Boolean(companyLogo);
  });
  if ($('settings-logo-preview')) {
    $('settings-logo-preview').innerHTML = companyLogo ? `<img src="${companyLogo}" alt="Company logo preview">` : '<i data-lucide="chef-hat"></i>';
    $('company-name-input').value = companyName;
  }
  if ($('sync-url-input')) {
    $('sync-url-input').value = syncConfig.url;
    $('sync-key-input').value = syncConfig.anonKey;
    $('sync-enabled-input').checked = syncConfig.enabled;
  }
  refreshIcons();
}
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}
async function installPos() {
  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') toast('Installing Synergy POS.');
    return;
  }
  const userAgent = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(userAgent)) return toast('In Safari, tap Share, then Add to Home Screen.');
  if (/android/i.test(userAgent)) return toast('In Chrome, open the menu and choose Install app or Add to Home screen.');
  toast('Use your browser menu or address-bar install icon to install this POS.');
}
function timestamp() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function getOpenTableOrder(table) {
  return orders.find(order => order.table === table && order.status !== 'paid' && order.status !== 'void');
}
function orderItemsTotal(items) {
  return items.reduce((sum, line) => sum + (menu.find(item => item.id === line.id)?.price || line.price || 0) * line.quantity, 0);
}
function totalsFor(items) {
  const subtotal = Number(orderItemsTotal(items).toFixed(2));
  const tax = Number((subtotal * TAX_RATE).toFixed(2));
  return { subtotal, tax, total: Number((subtotal + tax).toFixed(2)) };
}
function statusLabel(status) {
  return ({ new: 'New', preparing: 'Preparing', ready: 'Ready', served: 'Served', bill_requested: 'Bill requested', paid: 'Paid', void: 'Voided' })[status] || status;
}
function iconMarkup(name) { return `<i data-lucide="${name}"></i>`; }
function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function itemPhotoMarkup(item, className) {
  return `<span class="${className}">${item.image ? `<img src="${escapeAttribute(item.image)}" alt="" loading="lazy">` : ''}<span class="photo-fallback">${item.emoji || '🍽️'}</span></span>`;
}
function bindItemPhotoFallbacks(root) {
  root.querySelectorAll('.menu-photo img, .inventory-photo img').forEach(image => {
    image.addEventListener('load', () => { image.nextElementSibling.hidden = true; }, { once: true });
    image.addEventListener('error', () => image.remove(), { once: true });
    if (image.complete && image.naturalWidth) image.nextElementSibling.hidden = true;
  });
}
let editingPhotoItemId = null;
let editingMenuItemId = null;
function openItemEditor(itemId = null) {
  const item = itemId === null ? null : menu.find(entry => entry.id === Number(itemId));
  if (itemId !== null && !item) return;
  editingMenuItemId = item?.id ?? null;
  $('item-modal-title').textContent = item ? `Edit · ${item.name}` : 'Add menu item';
  $('item-name-input').value = item?.name || '';
  $('item-category-input').value = item?.category || 'Mains';
  $('item-station-input').value = item?.station || 'Kitchen';
  $('item-price-input').value = item?.price ?? '';
  $('item-stock-input').value = item?.stock ?? 20;
  $('item-emoji-input').value = item?.emoji || '🍽️';
  $('edit-item-photo').disabled = !item;
  $('item-modal').hidden = false;
  $('item-name-input').focus();
}
function saveMenuItem(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = String(data.get('name')).trim();
  const category = String(data.get('category')).trim();
  const station = String(data.get('station')).trim();
  const price = Number(data.get('price'));
  const stock = Number(data.get('stock'));
  const emoji = String(data.get('emoji')).trim() || '🍽️';
  if (!name || !category || !station || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
    return toast('Check the item name, category, station, price, and available portions.');
  }
  const item = editingMenuItemId === null ? null : menu.find(entry => entry.id === editingMenuItemId);
  const previousItem = item ? { ...item } : null;
  const updated = { ...(item || {}), id: item?.id ?? Date.now(), name, category, station, price, stock, emoji };
  if (item) Object.assign(item, updated);
  else menu.push(updated);
  try {
    persist();
  } catch {
    if (item) Object.assign(item, previousItem);
    else menu = menu.filter(entry => entry !== updated);
    return toast('Item could not be saved on this device.');
  }
  $('item-modal').hidden = true;
  renderAll();
  toast(item ? 'Menu item updated.' : 'Menu item added.');
}
function openPhotoEditor(itemId) {
  const item = menu.find(entry => entry.id === Number(itemId));
  if (!item) return;
  editingPhotoItemId = item.id;
  $('photo-title').textContent = `Photo · ${item.name}`;
  $('photo-url-input').value = item.image?.startsWith('http') ? item.image : '';
  $('menu-photo-file').value = '';
  updatePhotoPreview(item.image || '', item.emoji);
  $('photo-modal').hidden = false;
  $('photo-url-input').focus();
}
function updatePhotoPreview(source, emoji = '🍽️') {
  const preview = $('photo-preview');
  preview.innerHTML = `${source ? `<img src="${escapeAttribute(source)}" alt="Photo preview">` : ''}<span class="photo-fallback">${emoji}</span>`;
  const image = preview.querySelector('img');
  image?.addEventListener('load', () => { image.nextElementSibling.hidden = true; }, { once: true });
  image?.addEventListener('error', () => image.remove(), { once: true });
  if (image?.complete && image.naturalWidth) image.nextElementSibling.hidden = true;
}
function saveMenuPhoto(source) {
  const item = menu.find(entry => entry.id === editingPhotoItemId);
  if (!item) return;
  const previousImage = item.image || '';
  item.image = source;
  try {
    persist();
  } catch {
    item.image = previousImage;
    return toast('Photo could not be saved. Try a smaller image or a photo link.');
  }
  $('photo-modal').hidden = true;
  renderAll();
  toast(source ? 'Menu photo saved on this device.' : 'Menu photo removed.');
}
function usePhotoLink() {
  const value = $('photo-url-input').value.trim();
  if (!value) return toast('Enter a photo link first.');
  let url;
  try { url = new URL(value); } catch { return toast('Enter a valid photo link.'); }
  if (!['http:', 'https:'].includes(url.protocol)) return toast('Photo links must use HTTP or HTTPS.');
  saveMenuPhoto(url.href);
}
function loadLocalMenuPhoto(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    $('menu-photo-file').value = '';
    return toast('Choose a PNG, JPG, or WebP image under 10 MB.');
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    const scale = Math.min(1, 900 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const source = canvas.toDataURL('image/jpeg', 0.82);
    if (source.length > 700000) return toast('This photo is still too large after resizing. Try a smaller image.');
    saveMenuPhoto(source);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    toast('That image could not be opened.');
  };
  image.src = objectUrl;
}

function signIn(event) {
  event.preventDefault();
  const chosenRole = document.querySelector('input[name="role"]:checked').value;
  const pin = $('staff-pin').value.trim();
  const profile = chosenRole === 'admin' ? null : staffAccounts[chosenRole].find(entry => entry.id === $('staff-name').value);
  const validPin = chosenRole === 'admin' ? pin === ADMIN_PIN : profile?.enabled && pin === profile.pin;
  if (!validPin) {
    $('login-error').hidden = false;
    return;
  }
  role = chosenRole;
  staffName = chosenRole === 'admin' ? 'Synergy' : profile.name;
  activeSessionId = crypto.randomUUID();
  staffSessions.push({ id: activeSessionId, staffId: profile?.id || '', role, name: staffName, signedInAt: new Date().toISOString() });
  recordStaffActivity('Sign in', role, staffName);
  persist();
  sessionStorage.setItem('corner-table-role', role);
  sessionStorage.setItem('corner-table-staff', staffName);
  sessionStorage.setItem('corner-table-session', activeSessionId);
  $('login-error').hidden = true;
  $('login-screen').hidden = true;
  $('app-shell').hidden = false;
  $('user-name').textContent = staffName;
  $('user-avatar').textContent = staffName.slice(0, 1).toUpperCase();
  $('user-role').textContent = ROLE_LABELS[role];
  $('today-date').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  setupRoleNavigation();
  showView(role === 'waiter' ? 'waiter' : role === 'admin' ? 'counter' : role);
  renderAll();
}
function recordStaffActivity(action, staffRole, name) {
  staffActivity.unshift({ action, role: staffRole, name, at: new Date().toISOString() });
  staffActivity = staffActivity.slice(0, 100);
}
function signOut(recordActivity = true) {
  const currentSession = staffSessions.find(session => session.id === activeSessionId);
  if (currentSession) {
    staffSessions = staffSessions.filter(session => session.id !== activeSessionId);
    if (recordActivity) recordStaffActivity('Sign out', currentSession.role, currentSession.name);
    persist();
  }
  sessionStorage.removeItem('corner-table-role');
  sessionStorage.removeItem('corner-table-staff');
  sessionStorage.removeItem('corner-table-session');
  role = '';
  staffName = '';
  activeSessionId = '';
  $('app-shell').hidden = true;
  $('login-screen').hidden = false;
  $('staff-pin').value = '';
  $('login-error').hidden = true;
  $('staff-pin').focus();
  refreshIcons();
}
function updateLoginStaffName() {
  const chosenRole = document.querySelector('input[name="role"]:checked').value;
  const select = $('staff-name');
  const options = chosenRole === 'admin'
    ? [{ id: 'admin', name: 'Synergy' }]
    : staffAccounts[chosenRole].filter(profile => profile.enabled);
  select.innerHTML = options.length
    ? options.map(profile => `<option value="${escapeAttribute(profile.id)}">${escapeAttribute(profile.name)}</option>`).join('')
    : '<option value="" selected disabled>No staff enabled</option>';
}
function staffProfileMarkup(staffRole, profile) {
  return `<div class="staff-account-row" data-staff-role="${staffRole}" data-staff-id="${escapeAttribute(profile.id)}"><label class="field-label">Staff name<input class="text-field" data-staff-name maxlength="48" required value="${escapeAttribute(profile.name)}"></label><label class="field-label">PIN<input class="text-field" data-staff-pin type="password" maxlength="32" required value="${escapeAttribute(profile.pin)}"></label><label class="checkbox-row"><input data-staff-enabled type="checkbox" ${profile.enabled ? 'checked' : ''}> Allow sign in</label><button class="icon-button" data-remove-staff type="button" aria-label="Remove ${escapeAttribute(profile.name || 'staff member')}" title="Remove staff member"><i data-lucide="trash-2"></i></button></div>`;
}
function renderStaffManagement() {
  const panel = $('staff-management');
  panel.hidden = role !== 'admin';
  if (panel.hidden) return;
  ['waiter', 'kitchen'].forEach(staffRole => {
    $(`${staffRole}-staff-list`).innerHTML = staffAccounts[staffRole].map(profile => staffProfileMarkup(staffRole, profile)).join('') || '<p class="staff-empty">No staff added.</p>';
  });
  const managedSessions = staffSessions.filter(session => ['waiter', 'kitchen'].includes(session.role));
  $('staff-session-list').innerHTML = managedSessions.length ? managedSessions.map(session => `<div class="staff-session-row"><span><strong>${escapeAttribute(session.name)}</strong><small>${ROLE_LABELS[session.role]} · signed in ${new Date(session.signedInAt).toLocaleString()}</small></span><button class="small-action" data-force-logout="${escapeAttribute(session.id)}"><i data-lucide="log-out"></i> Sign out</button></div>`).join('') : '<p class="staff-empty">No waiter or kitchen sessions are signed in.</p>';
  $('staff-activity-list').innerHTML = staffActivity.length ? staffActivity.slice(0, 20).map(entry => `<div class="staff-activity-row"><strong>${escapeAttribute(entry.name)}</strong><span>${escapeAttribute(entry.action)} · ${ROLE_LABELS[entry.role] || 'Staff'}</span><time>${new Date(entry.at).toLocaleString()}</time></div>`).join('') : '<p class="staff-empty">No sign-in activity recorded yet.</p>';
  refreshIcons();
}
function saveStaffProfiles(event) {
  event.preventDefault();
  if (role !== 'admin') return;
  ['waiter', 'kitchen'].forEach(staffRole => {
    const rows = [...$(`${staffRole}-staff-list`).querySelectorAll('.staff-account-row')];
    const nextRoster = rows.map(row => ({
      id: row.dataset.staffId,
      name: row.querySelector('[data-staff-name]').value.trim(),
      pin: row.querySelector('[data-staff-pin]').value.trim(),
      enabled: row.querySelector('[data-staff-enabled]').checked
    }));
    const retainedSessions = [];
    staffSessions.filter(session => session.role === staffRole).forEach(session => {
      const account = nextRoster.find(profile => profile.id === (session.staffId || staffAccounts[staffRole].find(profile => profile.name === session.name)?.id));
      if (account?.enabled) retainedSessions.push(session);
      else recordStaffActivity('Signed out by administrator', session.role, session.name);
    });
    staffSessions = [...staffSessions.filter(session => session.role !== staffRole), ...retainedSessions];
    staffAccounts[staffRole] = nextRoster;
  });
  persist();
  updateLoginStaffName();
  renderStaffManagement();
  toast('Staff access saved.');
}
function forceStaffSignOut(sessionId) {
  if (role !== 'admin') return;
  const session = staffSessions.find(entry => entry.id === sessionId);
  if (!session) return;
  staffSessions = staffSessions.filter(entry => entry.id !== sessionId);
  recordStaffActivity('Signed out by administrator', session.role, session.name);
  persist();
  renderStaffManagement();
}
function updateStaffRosterFromEvent(event) {
  const addButton = event.target.closest('[data-add-staff]');
  if (addButton) {
    const staffRole = addButton.dataset.addStaff;
    const list = $(`${staffRole}-staff-list`);
    list.querySelector('.staff-empty')?.remove();
    list.insertAdjacentHTML('beforeend', staffProfileMarkup(staffRole, { id: crypto.randomUUID(), name: '', pin: '', enabled: true }));
    refreshIcons();
    return;
  }
  const removeButton = event.target.closest('[data-remove-staff]');
  if (removeButton) removeButton.closest('.staff-account-row').remove();
}
function setupRoleNavigation() {
  const nav = $('main-nav');
  const definitions = {
    waiter: [['waiter', 'Floor', 'layout-dashboard'], ['sales', 'Checks', 'receipt-text']],
    kitchen: [['kitchen', 'Kitchen display', 'chef-hat'], ['sales', 'Tickets', 'receipt-text']],
    admin: [['waiter', 'Floor & tables', 'layout-dashboard'], ['kitchen', 'Kitchen display', 'chef-hat'], ['counter', 'Counter POS', 'shopping-bag'], ['sales', 'Sales & checks', 'chart-no-axes-column'], ['inventory', 'Menu & stock', 'boxes']]
  };
  definitions[role].push(['settings', 'Settings', 'settings-2']);
  nav.innerHTML = definitions[role].map(([view, label, icon]) => `<button class="nav-item" data-view="${view}">${iconMarkup(icon)}<span>${label}</span></button>`).join('');
  nav.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  refreshIcons();
}
function showView(view) {
  if (role === 'waiter' && !['waiter', 'sales', 'settings'].includes(view)) return;
  if (role === 'kitchen' && !['kitchen', 'sales', 'settings'].includes(view)) return;
  if (role === 'counter' && !['counter', 'sales', 'inventory', 'settings'].includes(view)) return;
  activeView = view;
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `${view}-view`));
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const labels = { waiter: 'Floor', kitchen: 'Kitchen display', counter: 'Counter POS', sales: 'Sales & checks', inventory: 'Menu & stock', settings: 'Settings' };
  $('page-title').textContent = labels[view] || view;
  if (view === 'sales') renderSales();
  if (view === 'inventory') renderInventory();
  if (view === 'settings') {
    applyBranding();
    renderStaffManagement();
  }
  refreshIcons();
}
function renderCategories(containerId) {
  const categories = ['All', ...new Set(menu.map(item => item.category))];
  const container = $(containerId);
  container.innerHTML = categories.map(category => `<button class="category-button ${activeCategory === category ? 'active' : ''}" data-category="${category}">${category}</button>`).join('');
}
function filteredMenu(searchId) {
  const query = $(searchId).value.trim().toLowerCase();
  return menu.filter(item => (activeCategory === 'All' || item.category === activeCategory) && `${item.name} ${item.category} ${item.station}`.toLowerCase().includes(query));
}
function renderMenuGrid(gridId, searchId, target) {
  const matches = filteredMenu(searchId);
  $(gridId).innerHTML = matches.length ? matches.map(item => `<button class="menu-item ${item.stock <= 0 ? 'sold-out' : ''}" data-menu-add="${item.id}" data-target="${target}" ${item.stock <= 0 ? 'disabled' : ''}>${itemPhotoMarkup(item, 'menu-photo')}<span class="menu-item-copy"><strong>${escapeAttribute(item.name)}</strong><small>${escapeAttribute(item.category)} · ${item.stock} available</small></span><span class="menu-item-price">${money(item.price)}</span></button>`).join('') : '<div class="empty-products">No dishes match that search.</div>';
  bindItemPhotoFallbacks($(gridId));
}
function renderTables() {
  $('tables-grid').innerHTML = TABLES.map(table => {
    const order = getOpenTableOrder(table);
    const selected = table === selectedTable;
    const stateClass = order ? `occupied state-${order.status}` : 'available';
    return `<button class="table-tile ${stateClass} ${selected ? 'selected' : ''}" data-table="${table}"><span class="table-number">${String(table).padStart(2, '0')}</span><span class="table-state">${order ? statusLabel(order.status) : 'Available'}</span>${order ? `<small>${money(totalsFor(order.items).total)}</small>` : '<small>Seats 2–4</small>'}</button>`;
  }).join('');
  $('open-table-count').textContent = `${orders.filter(order => order.table && !['paid', 'void'].includes(order.status)).length} tables in service`;
}
function addToDraft(itemId, target) {
  const item = menu.find(entry => entry.id === Number(itemId));
  const draft = target === 'waiter' ? waiterDraft : counterDraft;
  if (!item || item.stock <= draft.filter(line => line.id === item.id).reduce((sum, line) => sum + line.quantity, 0)) return toast('No more portions available for this item.');
  const existing = draft.find(line => line.id === item.id);
  if (existing) existing.quantity += 1;
  else draft.push({ id: item.id, quantity: 1, note: '' });
  renderDraft(target);
}
function orderForSelectedTable() { return selectedTable ? getOpenTableOrder(selectedTable) : null; }
function combinedWaiterLines() {
  return [...(orderForSelectedTable()?.items || []).map(line => ({ ...line, saved: true })), ...waiterDraft.map(line => ({ ...line, saved: false }))];
}
function renderDraft(target) {
  const isWaiter = target === 'waiter';
  const draft = isWaiter ? waiterDraft : counterDraft;
  const existingOrder = isWaiter ? orderForSelectedTable() : null;
  const lines = isWaiter ? combinedWaiterLines() : draft;
  const linesId = isWaiter ? 'waiter-ticket-lines' : 'counter-ticket-lines';
  const totalsId = isWaiter ? 'waiter-totals' : 'counter-totals';
  const subtotalItems = isWaiter ? lines : draft;
  const subtotal = totalsFor(subtotalItems).subtotal;
  $(linesId).innerHTML = lines.length ? lines.map((line, index) => {
    const item = menu.find(entry => entry.id === line.id);
    return `<div class="ticket-line">${item ? itemPhotoMarkup(item, 'line-photo') : '<span class="line-emoji">🍽️</span>'}<div class="line-main"><strong>${escapeAttribute(item?.name || 'Removed item')}</strong><small>${money(item?.price || 0)}${line.note ? ` · ${line.note}` : ''}${line.saved ? ' · sent' : ''}</small>${line.saved ? '' : `<div class="line-controls"><button data-line-action="minus" data-target="${target}" data-index="${index}" aria-label="Remove one">−</button><span>${line.quantity}</span><button data-line-action="plus" data-target="${target}" data-index="${index}" aria-label="Add one">+</button><button class="note-action" data-line-action="note" data-target="${target}" data-index="${index}">Note</button></div>`}</div><strong class="line-total">${money((item?.price || 0) * line.quantity)}</strong></div>`;
  }).join('') : '<div class="ticket-empty"><i data-lucide="notebook-tabs"></i><span>Add menu items to start this check.</span></div>';
  const totals = totalsFor(subtotalItems);
  $(totalsId).innerHTML = `<div><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div><div><span>Tax <small>(5%)</small></span><strong>${money(totals.tax)}</strong></div><div class="total-row"><span>Total</span><strong>${money(totals.total)}</strong></div>`;
  if (isWaiter) {
    const order = existingOrder;
    $('selected-table-title').textContent = selectedTable ? `Table ${selectedTable}` : 'Choose a table';
    $('table-order-ref').textContent = order ? `Check #${order.number} · ${statusLabel(order.status)}` : '';
    $('send-kitchen').disabled = !selectedTable || !waiterDraft.length;
    $('request-bill').disabled = !order || order.status === 'bill_requested' || order.status === 'paid';
    $('mark-served').hidden = !order || order.status !== 'ready';
    $('send-kitchen').innerHTML = order?.status === 'bill_requested' ? 'Add items <i data-lucide="send"></i>' : 'Send to kitchen <i data-lucide="send"></i>';
  } else {
    $('counter-checkout').disabled = !draft.length;
  }
  refreshIcons();
}
function selectTable(table) {
  selectedTable = Number(table);
  waiterDraft = [];
  const order = orderForSelectedTable();
  $('guest-count').value = order?.guests || 2;
  renderTables();
  renderDraft('waiter');
}
function sendToKitchen() {
  if (!selectedTable || !waiterDraft.length) return;
  let order = orderForSelectedTable();
  if (!order) {
    order = { id: crypto.randomUUID(), number: nextOrderNumber++, type: 'Dine-in', table: selectedTable, guests: Number($('guest-count').value), items: [], status: 'new', createdAt: timestamp(), createdISO: new Date().toISOString(), staff: staffName };
    orders.push(order);
  }
  order.items.push(...waiterDraft.map(line => ({ ...line })));
  order.guests = Number($('guest-count').value);
  order.status = 'new';
  order.sentAt = timestamp();
  consumeStock(waiterDraft);
  waiterDraft = [];
  persist();
  renderAll();
  toast(`Check #${order.number} sent to kitchen.`);
}
function consumeStock(lines) {
  lines.forEach(line => {
    const item = menu.find(entry => entry.id === line.id);
    if (item) item.stock = Math.max(0, item.stock - line.quantity);
  });
}
function updateLineFromEvent(event) {
  const button = event.target.closest('[data-line-action]');
  if (!button) return;
  const target = button.dataset.target;
  const index = Number(button.dataset.index);
  const draft = target === 'waiter' ? waiterDraft : counterDraft;
  const line = draft[index];
  if (!line) return;
  if (button.dataset.lineAction === 'note') {
    const note = window.prompt('Add a kitchen note (for example: no onions):', line.note || '');
    if (note !== null) line.note = note.trim();
  } else if (button.dataset.lineAction === 'plus') {
    const item = menu.find(entry => entry.id === line.id);
    if ((item?.stock || 0) <= draft.filter(entry => entry.id === line.id).reduce((sum, entry) => sum + entry.quantity, 0)) return toast('No more portions available for this item.');
    line.quantity += 1;
  } else {
    line.quantity -= 1;
    if (line.quantity <= 0) draft.splice(index, 1);
  }
  renderDraft(target);
}
function renderKitchen() {
  const active = orders.filter(order => ['new', 'preparing', 'ready'].includes(order.status));
  $('kitchen-count').textContent = `${active.filter(order => order.status !== 'ready').length} active tickets`;
  let visible = active;
  if (kitchenFilter === 'active') visible = active.filter(order => ['new', 'preparing'].includes(order.status));
  if (kitchenFilter === 'ready') visible = active.filter(order => order.status === 'ready');
  if (kitchenFilter === 'all') visible = orders.filter(order => ['new', 'preparing', 'ready', 'served'].includes(order.status));
  $('kitchen-grid').innerHTML = visible.length ? [...visible].sort((a, b) => new Date(a.createdISO) - new Date(b.createdISO)).map(order => {
    const age = Math.max(0, Math.floor((Date.now() - new Date(order.createdISO).getTime()) / 60000));
    const action = order.status === 'new' ? ['preparing', 'Start preparing', 'play'] : order.status === 'preparing' ? ['ready', 'Mark ready', 'check'] : null;
    const footerAction = action ? `<button class="primary-button" data-ticket-action="${action[0]}" data-order-id="${order.id}">${iconMarkup(action[2])} ${action[1]}</button>` : `<span class="ticket-handoff">${order.status === 'ready' ? 'Awaiting pickup' : 'Served'}</span>`;
    return `<article class="kitchen-ticket ${order.status === 'ready' ? 'ticket-ready' : ''}"><header><div><span class="ticket-number">#${order.number}</span><span class="ticket-kind">${order.table ? `Table ${order.table}` : order.type}</span></div><span class="ticket-age ${age >= 15 && order.status !== 'ready' ? 'late' : ''}">${age} min</span></header><div class="kitchen-ticket-meta"><span class="status-tag ${order.status}">${statusLabel(order.status)}</span><span>${order.guests ? `${order.guests} guests` : order.staff || ''}</span></div><div class="kitchen-ticket-items">${order.items.map(line => { const item = menu.find(entry => entry.id === line.id); return `<div><span><b>${line.quantity}×</b> ${escapeAttribute(item?.name || 'Menu item')} ${line.note ? `<small>· ${escapeAttribute(line.note)}</small>` : ''}</span><small>${escapeAttribute(item?.station || '')}</small></div>`; }).join('')}</div><footer><strong>${timestampText(order.sentAt || order.createdAt)}</strong>${footerAction}</footer></article>`;
  }).join('') : `<div class="empty-state kitchen-empty"><i data-lucide="chef-hat"></i><strong>${kitchenFilter === 'ready' ? 'Nothing on the pass' : 'No tickets in the queue'}</strong><span>New orders appear here as soon as they are sent.</span></div>`;
  refreshIcons();
}
function timestampText(value) { return value || 'Just now'; }
function advanceTicket(orderId, action) {
  const order = orders.find(entry => entry.id === orderId);
  if (!order) return;
  order.status = action;
  order.updatedAt = timestamp();
  persist();
  renderAll();
  toast(action === 'preparing' ? `Check #${order.number} started.` : action === 'ready' ? `Check #${order.number} is ready.` : `Check #${order.number} completed.`);
}
function requestBill() {
  const order = orderForSelectedTable();
  if (!order) return;
  order.status = 'bill_requested';
  order.updatedAt = timestamp();
  persist();
  renderAll();
  toast(`Bill for table ${selectedTable} sent to counter.`);
}
function markServed() {
  const order = orderForSelectedTable();
  if (!order || order.status !== 'ready') return;
  order.status = 'served';
  persist();
  renderAll();
  toast(`Table ${selectedTable} marked served.`);
}
function startPayment(source, orderId = null) {
  paymentSource = source;
  paymentOrderId = orderId;
  paymentMethod = 'Card';
  document.querySelectorAll('.payment-method').forEach(button => button.classList.toggle('selected', button.dataset.method === paymentMethod));
  const lines = source === 'counter' ? counterDraft : orders.find(order => order.id === orderId)?.items || [];
  const total = totalsFor(lines).total;
  $('modal-total').textContent = money(total);
  $('cash-received').value = '';
  $('cash-field').hidden = true;
  $('change-line').hidden = true;
  $('payment-modal').hidden = false;
  refreshIcons();
}
function completePayment() {
  let order = paymentSource === 'counter' ? null : orders.find(entry => entry.id === paymentOrderId);
  const lines = paymentSource === 'counter' ? counterDraft : order?.items || [];
  if (!lines.length) return;
  const totals = totalsFor(lines);
  if (paymentMethod === 'Cash' && Number($('cash-received').value) < totals.total) return toast('Cash received must cover the check total.');
  if (!order) {
    order = { id: crypto.randomUUID(), number: nextOrderNumber++, type: $('counter-order-type').value, table: null, guests: 1, items: counterDraft.map(line => ({ ...line })), status: 'paid', createdAt: timestamp(), createdISO: new Date().toISOString(), staff: staffName };
    consumeStock(counterDraft);
    orders.push(order);
  } else {
    order.status = 'paid';
  }
  order.payment = paymentMethod;
  order.paidAt = timestamp();
  order.paidAtISO = new Date().toISOString();
  order.total = totals.total;
  order.subtotal = totals.subtotal;
  order.tax = totals.tax;
  order.taxRate = TAX_RATE;
  order.staffPaid = staffName;
  if (paymentMethod === 'Cash') {
    order.cashReceived = Number($('cash-received').value);
    order.changeDue = Number((order.cashReceived - totals.total).toFixed(2));
  }
  lastReceipt = { ...order, items: order.items.map(line => {
    const item = menu.find(entry => entry.id === line.id);
    return { ...line, name: item?.name || 'Menu item', category: item?.category || '', price: item?.price || 0 };
  }), total: totals.total, tax: totals.tax, subtotal: totals.subtotal };
  counterDraft = [];
  $('payment-modal').hidden = true;
  persist();
  renderAll();
  renderReceipt(lastReceipt);
  toast(`Payment complete · ${money(totals.total)} · Check #${order.number}`);
  if (paymentSource === 'bill') printReceipt();
}
function renderBills() {
  const bills = orders.filter(order => order.status === 'bill_requested' || order.status === 'served');
  $('bill-count').textContent = `${bills.filter(order => order.status === 'bill_requested').length} waiting`;
  $('bill-list').innerHTML = bills.length ? bills.map(order => `<article class="bill-row"><div><strong>Table ${order.table} <span>#${order.number}</span></strong><small>${order.items.reduce((sum, line) => sum + line.quantity, 0)} items · ${order.guests} guests · ${statusLabel(order.status)}</small></div><strong>${money(totalsFor(order.items).total)}</strong><button class="small-action" data-settle="${order.id}">Settle bill <i data-lucide="arrow-right"></i></button></article>`).join('') : '<div class="bill-empty">No table bills waiting for payment.</div>';
  refreshIcons();
}
function renderSales() {
  const paid = orders.filter(order => order.status === 'paid');
  const total = paid.reduce((sum, order) => sum + (order.total ?? totalsFor(order.items).total), 0);
  const open = orders.filter(order => !['paid', 'void'].includes(order.status)).length;
  $('sales-summary').innerHTML = `<div><span>Net sales</span><strong>${money(total)}</strong></div><div><span>Paid checks</span><strong>${paid.length}</strong></div><div><span>Open checks</span><strong>${open}</strong></div><div><span>Average check</span><strong>${money(paid.length ? total / paid.length : 0)}</strong></div>`;
  $('sales-empty').hidden = orders.length > 0;
  $('sales-table').innerHTML = [...orders].reverse().map(order => `<tr><td><strong>#${order.number}</strong></td><td>${order.paidAt || order.createdAt}</td><td>${order.table ? `Table ${order.table}` : order.type}</td><td>${order.items.reduce((sum, line) => sum + line.quantity, 0)}</td><td>${order.payment || `<span class="status-tag ${order.status}">${statusLabel(order.status)}</span>`}</td><td class="align-right"><strong>${money(order.total ?? totalsFor(order.items).total)}</strong></td></tr>`).join('');
}
function renderInventory() {
  $('inventory-summary').innerHTML = `<div><span>Menu items</span><strong>${menu.length}</strong></div><div><span>Low stock</span><strong class="low-stock-number">${menu.filter(item => item.stock <= 5).length}</strong></div><div><span>Out of stock</span><strong>${menu.filter(item => item.stock <= 0).length}</strong></div>`;
  $('inventory-table').innerHTML = menu.map(item => `<tr><td><div class="inventory-item">${itemPhotoMarkup(item, 'inventory-photo')}<strong>${escapeAttribute(item.emoji)} ${escapeAttribute(item.name)}</strong></div></td><td>${escapeAttribute(item.category)}</td><td>${escapeAttribute(item.station)}</td><td class="${item.stock <= 5 ? 'stock-low' : ''}">${item.stock}</td><td class="align-right"><strong>${money(item.price)}</strong></td><td><div class="inventory-actions"><button class="small-action" data-edit-item="${item.id}"><i data-lucide="pencil"></i> Edit</button><button class="small-action" data-edit-photo="${item.id}" aria-label="Edit photo for ${escapeAttribute(item.name)}"><i data-lucide="image"></i> Photo</button><button class="small-action" data-stock="${item.id}">Adjust</button></div></td></tr>`).join('');
  bindItemPhotoFallbacks($('inventory-table'));
  refreshIcons();
}
function renderAll() {
  if (role === 'waiter' || role === 'admin') {
    renderCategories('waiter-categories');
    renderMenuGrid('waiter-menu-grid', 'waiter-search', 'waiter');
    renderTables();
    renderDraft('waiter');
  }
  if (role === 'counter' || role === 'admin') {
    renderCategories('counter-categories');
    renderMenuGrid('counter-menu-grid', 'counter-search', 'counter');
    renderDraft('counter');
    renderBills();
  }
  if (role === 'kitchen' || role === 'admin') renderKitchen();
  if (activeView === 'sales') renderSales();
  if (activeView === 'inventory') renderInventory();
  refreshIcons();
}
function renderReceipt(order) {
  const itemRows = order.items.map(line => {
    const item = menu.find(entry => entry.id === line.id);
    const itemName = line.name || item?.name || 'Menu item';
    const itemPrice = line.price ?? item?.price ?? 0;
    return `<div class="receipt-item"><div class="receipt-item-name"><span>${line.quantity} × ${escapeAttribute(itemName)}</span><b>${money(itemPrice * line.quantity)}</b></div><small>${money(itemPrice)} each${line.category ? ` · ${escapeAttribute(line.category)}` : ''}</small>${line.note ? `<small class="receipt-note">Note: ${escapeAttribute(line.note)}</small>` : ''}</div>`;
  }).join('');
  const paidDate = order.paidAtISO ? new Date(order.paidAtISO) : new Date();
  const location = order.table ? `Dine in · Table ${order.table}` : order.type || 'Counter order';
  const cashDetails = order.payment === 'Cash' && Number.isFinite(order.cashReceived) ? `<div class="receipt-row"><span>Cash received</span><b>${money(order.cashReceived)}</b></div><div class="receipt-row"><span>Change</span><b>${money(order.changeDue)}</b></div>` : '';
  const logo = companyLogo ? `<img class="receipt-logo" src="${companyLogo}" alt="">` : '';
  $('receipt-print').innerHTML = `<header class="receipt-header">${logo}<h2>${companyName}</h2><p>Downtown · Main floor</p><p>Restaurant guest receipt</p></header><div class="receipt-meta"><div><span>Check</span><b>#${order.number}</b></div><div><span>Date</span><b>${paidDate.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</b></div><div><span>Time</span><b>${paidDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b></div><div><span>Order</span><b>${location}</b></div><div><span>Guests</span><b>${order.guests || 1}</b></div><div><span>Served by</span><b>${order.staffPaid || order.staff || 'Team'}</b></div></div><div class="receipt-section-title">ORDER DETAILS</div><div class="receipt-items">${itemRows}</div><div class="receipt-totals"><div class="receipt-row"><span>Subtotal</span><b>${money(order.subtotal)}</b></div><div class="receipt-row"><span>Sales tax (${((order.taxRate ?? TAX_RATE) * 100).toFixed(0)}%)</span><b>${money(order.tax)}</b></div><div class="receipt-row receipt-grand-total"><span>Total paid</span><b>${money(order.total)}</b></div></div><div class="receipt-payment"><span>Payment method</span><b>${order.payment || 'Paid'}</b></div>${cashDetails}<footer class="receipt-footer"><strong>Thank you for dining with us.</strong><span>We hope to see you again soon.</span><small>${companyName} · Check #${order.number}</small></footer>`;
}
function printReceipt() {
  if (!lastReceipt) return toast('Complete a payment to print a receipt.');
  window.print();
}
function adjustStock(id) {
  const item = menu.find(entry => entry.id === Number(id));
  if (!item) return;
  const stock = Number(window.prompt(`Set available portions for ${item.name}:`, String(item.stock)));
  if (!Number.isInteger(stock) || stock < 0) return toast('Enter a whole number of 0 or more.');
  item.stock = stock;
  persist();
  renderAll();
  toast(`${item.name} stock updated.`);
}
function exportSales() {
  if (!orders.length) return toast('There are no checks to export yet.');
  const rows = [['Check', 'Time', 'Type', 'Items', 'Status', 'Payment', 'Total'], ...orders.map(order => [order.number, order.paidAt || order.createdAt, order.table ? `Table ${order.table}` : order.type, order.items.reduce((sum, line) => sum + line.quantity, 0), statusLabel(order.status), order.payment || '', (order.total ?? totalsFor(order.items).total).toFixed(2)])];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'corner-table-sales.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}
function initialize() {
  $('login-form').addEventListener('submit', signIn);
  $('install-app').addEventListener('click', installPos);
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install-app').hidden = true;
  document.querySelectorAll('input[name="role"]').forEach(input => input.addEventListener('change', () => { $('login-error').hidden = true; updateLoginStaffName(); }));
  updateLoginStaffName();
  $('logout-button').addEventListener('click', signOut);
  $('switch-station').addEventListener('click', signOut);
  $('waiter-menu-grid').addEventListener('click', event => { const button = event.target.closest('[data-menu-add]'); if (button) addToDraft(button.dataset.menuAdd, 'waiter'); });
  $('counter-menu-grid').addEventListener('click', event => { const button = event.target.closest('[data-menu-add]'); if (button) addToDraft(button.dataset.menuAdd, 'counter'); });
  $('tables-grid').addEventListener('click', event => { const button = event.target.closest('[data-table]'); if (button) selectTable(button.dataset.table); });
  $('waiter-ticket-lines').addEventListener('click', updateLineFromEvent);
  $('counter-ticket-lines').addEventListener('click', updateLineFromEvent);
  ['waiter-categories', 'counter-categories'].forEach(id => $(id).addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    activeCategory = button.dataset.category;
    renderAll();
  }));
  $('waiter-search').addEventListener('input', () => renderMenuGrid('waiter-menu-grid', 'waiter-search', 'waiter'));
  $('counter-search').addEventListener('input', () => renderMenuGrid('counter-menu-grid', 'counter-search', 'counter'));
  $('guest-count').addEventListener('change', () => { const order = orderForSelectedTable(); if (order) { order.guests = Number($('guest-count').value); persist(); } });
  $('send-kitchen').addEventListener('click', sendToKitchen);
  $('request-bill').addEventListener('click', requestBill);
  $('mark-served').addEventListener('click', markServed);
  $('clear-waiter-draft').addEventListener('click', () => { waiterDraft = []; renderDraft('waiter'); });
  $('clear-counter-draft').addEventListener('click', () => { counterDraft = []; renderDraft('counter'); });
  $('counter-checkout').addEventListener('click', () => startPayment('counter'));
  $('kitchen-grid').addEventListener('click', event => { const button = event.target.closest('[data-ticket-action]'); if (button) advanceTicket(button.dataset.orderId, button.dataset.ticketAction); });
  $('kitchen-filters').addEventListener('click', event => { const button = event.target.closest('[data-kitchen-filter]'); if (!button) return; kitchenFilter = button.dataset.kitchenFilter; document.querySelectorAll('[data-kitchen-filter]').forEach(item => item.classList.toggle('active', item === button)); renderKitchen(); });
  $('bill-list').addEventListener('click', event => { const button = event.target.closest('[data-settle]'); if (button) startPayment('bill', button.dataset.settle); });
  document.querySelectorAll('[data-method]').forEach(button => button.addEventListener('click', () => {
    paymentMethod = button.dataset.method;
    document.querySelectorAll('[data-method]').forEach(item => item.classList.toggle('selected', item === button));
    $('cash-field').hidden = paymentMethod !== 'Cash';
    $('change-line').hidden = true;
  }));
  $('cash-received').addEventListener('input', () => {
    const due = Number($('modal-total').textContent.replace('$', ''));
    const received = Number($('cash-received').value);
    $('change-line').textContent = received >= due ? `Change due ${money(received - due)}` : `Remaining ${money(due - received)}`;
    $('change-line').hidden = !received;
  });
  $('confirm-payment').addEventListener('click', completePayment);
  document.querySelectorAll('[data-close-payment]').forEach(button => button.addEventListener('click', () => { $('payment-modal').hidden = true; }));
  $('payment-modal').addEventListener('click', event => { if (event.target === $('payment-modal')) $('payment-modal').hidden = true; });
  $('export-orders').addEventListener('click', exportSales);
  $('print-receipt').addEventListener('click', printReceipt);
  $('close-photo-editor').addEventListener('click', () => { $('photo-modal').hidden = true; });
  $('photo-modal').addEventListener('click', event => { if (event.target === $('photo-modal')) $('photo-modal').hidden = true; });
  $('use-photo-url').addEventListener('click', usePhotoLink);
  $('save-photo-editor').addEventListener('click', usePhotoLink);
  $('remove-menu-photo').addEventListener('click', () => saveMenuPhoto(''));
  $('menu-photo-file').addEventListener('change', event => loadLocalMenuPhoto(event.target.files?.[0]));
  $('add-menu-item').addEventListener('click', () => openItemEditor());
  $('item-edit-form').addEventListener('submit', saveMenuItem);
  $('close-item-editor').addEventListener('click', () => { $('item-modal').hidden = true; });
  $('item-modal').addEventListener('click', event => { if (event.target === $('item-modal')) $('item-modal').hidden = true; });
  $('edit-item-photo').addEventListener('click', () => openPhotoEditor(editingMenuItemId));
  $('company-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    companyName = $('company-name-input').value.trim() || 'Corner Table';
    applyBranding();
    persist();
    toast('Company branding saved.');
  });
  $('save-sync-config').addEventListener('click', () => {
    const nextConfig = {
      enabled: $('sync-enabled-input').checked,
      url: $('sync-url-input').value.trim(),
      anonKey: $('sync-key-input').value.trim()
    };
    syncConfig = nextConfig;
    saveSyncConfig(syncConfig);
    if (nextConfig.enabled && nextConfig.url && nextConfig.anonKey) {
      startCloudSync();
      void hydrateFromCloud();
      toast('Connecting to Supabase…');
    } else {
      stopCloudSync();
      setCloudSyncStatus('Cloud sync is off. Local changes remain saved on this device.', 'idle');
      toast('Cloud sync disabled on this device.');
    }
  });
  $('staff-settings-form').addEventListener('submit', saveStaffProfiles);
  $('staff-settings-form').addEventListener('click', updateStaffRosterFromEvent);
  $('staff-session-list').addEventListener('click', event => {
    const button = event.target.closest('[data-force-logout]');
    if (button) forceStaffSignOut(button.dataset.forceLogout);
  });
  $('company-logo-file').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 1024 * 1024) {
      event.target.value = '';
      return toast('Choose a PNG, JPG, WebP, or SVG image under 1 MB.');
    }
    const reader = new FileReader();
    reader.onload = () => {
      companyLogo = String(reader.result || '');
      applyBranding();
      persist();
      toast('Company logo updated.');
    };
    reader.readAsDataURL(file);
  });
  $('remove-company-logo').addEventListener('click', () => {
    companyLogo = '';
    $('company-logo-file').value = '';
    applyBranding();
    persist();
    toast('Company logo removed.');
  });
  $('inventory-table').addEventListener('click', event => {
    const editButton = event.target.closest('[data-edit-item]');
    const photoButton = event.target.closest('[data-edit-photo]');
    const stockButton = event.target.closest('[data-stock]');
    if (editButton) openItemEditor(editButton.dataset.editItem);
    else if (photoButton) openPhotoEditor(photoButton.dataset.editPhoto);
    else if (stockButton) adjustStock(stockButton.dataset.stock);
  });
  document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.openView)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('payment-modal').hidden = true; $('photo-modal').hidden = true; $('item-modal').hidden = true; } });
  let storedRole = sessionStorage.getItem('corner-table-role');
  const storedName = sessionStorage.getItem('corner-table-staff');
  let storedSessionId = sessionStorage.getItem('corner-table-session');
  if (storedRole === 'counter') {
    storedRole = 'admin';
    sessionStorage.setItem('corner-table-role', storedRole);
  }
  if (!saved.companyName || saved.companyName === 'Corner Table') persist();
  if (syncConfig.enabled && syncConfig.url && syncConfig.anonKey) {
    startCloudSync();
    void hydrateFromCloud();
  }
  const storedSessionExists = storedSessionId && staffSessions.some(session => session.id === storedSessionId);
  if (storedRole && ROLE_LABELS[storedRole] && storedName && (!storedSessionId || storedSessionExists)) {
    role = storedRole;
    staffName = role === 'admin' ? 'Synergy' : storedName;
    if (!storedSessionId) {
      storedSessionId = crypto.randomUUID();
      const restoredProfile = ['waiter', 'kitchen'].includes(role) ? staffAccounts[role].find(profile => profile.name === staffName) : null;
      staffSessions.push({ id: storedSessionId, staffId: restoredProfile?.id || '', role, name: staffName, signedInAt: new Date().toISOString() });
      sessionStorage.setItem('corner-table-session', storedSessionId);
      persist();
    }
    activeSessionId = storedSessionId;
    const restoredSession = staffSessions.find(session => session.id === activeSessionId);
    if (restoredSession && !restoredSession.staffId && ['waiter', 'kitchen'].includes(role)) {
      restoredSession.staffId = staffAccounts[role].find(profile => profile.name === staffName)?.id || '';
    }
    $('staff-name').value = staffName;
    $('login-screen').hidden = true;
    $('app-shell').hidden = false;
    $('user-name').textContent = staffName;
    $('user-avatar').textContent = staffName.slice(0, 1).toUpperCase();
    $('user-role').textContent = ROLE_LABELS[role];
    $('today-date').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    setupRoleNavigation();
    showView(role === 'waiter' ? 'waiter' : role === 'admin' ? 'counter' : role);
    renderAll();
  }
  if (storedSessionId && !storedSessionExists) {
    sessionStorage.removeItem('corner-table-role');
    sessionStorage.removeItem('corner-table-staff');
    sessionStorage.removeItem('corner-table-session');
  }
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const latest = JSON.parse(event.newValue);
      if (Array.isArray(latest.staffAccounts?.waiter)) staffAccounts.waiter = latest.staffAccounts.waiter;
      if (Array.isArray(latest.staffAccounts?.kitchen)) staffAccounts.kitchen = latest.staffAccounts.kitchen;
      staffSessions = Array.isArray(latest.staffSessions) ? latest.staffSessions : staffSessions;
      staffActivity = Array.isArray(latest.staffActivity) ? latest.staffActivity : staffActivity;
      if (activeSessionId && !staffSessions.some(session => session.id === activeSessionId)) signOut(false);
      else if (role === 'admin' && activeView === 'settings') renderStaffManagement();
      else if (!role) updateLoginStaffName();
    } catch {}
  });
  applyBranding();
  refreshIcons();
}
initialize();
window.addEventListener('load', refreshIcons);
