// ========================================
// AUTHENTICATION & STATE
// ========================================
const BACKEND_URL = 'http://localhost:9201';
const socket = io(BACKEND_URL);

// Demo credentials
const DEMO_USERS = {
  admin: { password: 'admin123', role: 'admin' },
  customer: { password: 'customer123', role: 'customer' }
};

// Global state
let currentUser = null;
let currentRole = null;
let lastScannedUid = null;
let lastScannedBalance = null;
let products = [];
let cart = [];
let transactionStats = {
  total: 0,
  success: 0,
  failed: 0
};

// ========================================
// DOM ELEMENTS
// ========================================
// Login
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

// Navbar
const connectionStatus = document.getElementById('connection-status');
const connectionText = document.getElementById('connection-text');
const userRoleBadge = document.getElementById('user-role-badge');
const userName = document.getElementById('user-name');

// Sidebar
const menuItems = document.querySelectorAll('.menu-item');
const contentSections = document.querySelectorAll('.content-section');
const adminMenu = document.getElementById('admin-menu');
const customerMenu = document.getElementById('customer-menu');

// Dashboard
const cardVisual = document.getElementById('card-visual');
const cardUidDisplay = document.getElementById('card-uid-display');
const cardBalanceDisplay = document.getElementById('card-balance-display');
const statusDisplay = document.getElementById('status-display');
const logList = document.getElementById('log-list');

// Stats
const statTransactions = document.getElementById('stat-transactions');
const statSuccess = document.getElementById('stat-success');
const statFailed = document.getElementById('stat-failed');

// Admin
const adminUid = document.getElementById('admin-uid');
const adminCurrentBalance = document.getElementById('admin-current-balance');
const adminAmount = document.getElementById('admin-amount');
const adminTopupBtn = document.getElementById('admin-topup-btn');
const adminResponse = document.getElementById('admin-response');

// Customer
const customerUid = document.getElementById('customer-uid');
const customerCurrentBalance = document.getElementById('customer-current-balance');
const productsGrid = document.getElementById('products-grid');
const productSearch = document.getElementById('product-search');
const cartItems = document.getElementById('cart-items');
const cartSubtotal = document.getElementById('cart-subtotal');
const cartTotal = document.getElementById('cart-total');
const customerPayBtn = document.getElementById('customer-pay-btn');
const customerResponse = document.getElementById('customer-response');

// ========================================
// LOGIN HANDLERS
// ========================================
// LOGIN HANDLERS
// ========================================
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const role = document.getElementById('login-role').value;

    loginError.textContent = '';

    console.log('Login attempt:', { username, role });

    // Validate
    if (!username || !password || !role) {
      loginError.textContent = 'Please fill all fields';
      return;
    }

    // Check credentials
    const user = DEMO_USERS[username];
    if (!user || user.password !== password || user.role !== role) {
      loginError.textContent = 'Invalid credentials';
      console.log('Invalid credentials');
      return;
    }

    // Login successful
    currentUser = username;
    currentRole = role;
    console.log('Login successful');
    performLogin();
  });
} else {
  console.error('Login form not found!');
}

function performLogin() {
  // Update UI
  userName.textContent = currentUser;
  userRoleBadge.textContent = currentRole.charAt(0).toUpperCase() + currentRole.slice(1);

  // Show/hide role-specific menus
  if (currentRole === 'admin') {
    adminMenu.style.display = 'flex';
    customerMenu.style.display = 'none';
  } else {
    adminMenu.style.display = 'none';
    customerMenu.style.display = 'flex';
  }

  // Switch screens
  loginScreen.classList.remove('active');
  dashboardScreen.classList.add('active');

  // Reset form
  loginForm.reset();

  // Request products - wait for socket connection
  console.log('Socket connected:', socket.connected);
  if (socket.connected) {
    console.log('Requesting products...');
    socket.emit('request-products');
  } else {
    console.log('Socket not connected, waiting...');
    // Wait for connection then request
    socket.once('connect', () => {
      console.log('Socket connected, now requesting products...');
      socket.emit('request-products');
    });
  }

  addLog(`✓ ${currentUser} logged in as ${currentRole}`);
}

logoutBtn.addEventListener('click', () => {
  currentUser = null;
  currentRole = null;
  lastScannedUid = null;
  lastScannedBalance = null;

  // Clear forms
  adminUid.value = '';
  adminCurrentBalance.value = '';
  adminAmount.value = '';
  customerUid.value = '';
  customerCurrentBalance.value = '';
  cart = [];
  renderCart();
  updateCartTotal();

  // Switch screens
  dashboardScreen.classList.remove('active');
  loginScreen.classList.add('active');

  // Reset menu
  menuItems.forEach(item => item.classList.remove('active'));
  menuItems[0].classList.add('active');
  contentSections.forEach(section => section.classList.remove('active'));
  contentSections[0].classList.add('active');

  addLog('Logged out');
});

// ========================================
// SIDEBAR NAVIGATION
// ========================================
menuItems.forEach(item => {
  item.addEventListener('click', () => {
    const section = item.dataset.section;

    // Update active menu
    menuItems.forEach(m => m.classList.remove('active'));
    item.classList.add('active');

    // Update active section
    contentSections.forEach(s => s.classList.remove('active'));
    document.getElementById(`${section}-section`).classList.add('active');
    
    // If switching to customer section, populate products
    if (section === 'customer' && products.length > 0) {
      console.log('Switching to customer section, populating products');
      setTimeout(() => populateProductList(), 100);
    }
  });
});

// ========================================
// WEBSOCKET EVENTS
// ========================================
socket.on('connect', () => {
  console.log('✓ Socket connected');
  addLog('✓ Connected to backend');
  connectionStatus.classList.remove('offline');
  connectionStatus.classList.add('online');
  connectionText.textContent = 'Connected';
  
  // Request products immediately on connect
  console.log('Requesting products on connect...');
  socket.emit('request-products');
});

socket.on('disconnect', () => {
  addLog('✗ Disconnected from backend');
  connectionStatus.classList.remove('online');
  connectionStatus.classList.add('offline');
  connectionText.textContent = 'Disconnected';
});

// Card scanned
socket.on('card-scanned', (data) => {
  const { uid } = data;
  addLog(`🔍 Card detected: ${uid}`);

  lastScannedUid = uid;

  // Update card visual
  cardVisual.classList.add('active');
  cardUidDisplay.textContent = uid;

  // Update forms
  adminUid.value = uid;
  adminTopupBtn.disabled = false;

  customerUid.value = uid;
  if (products.length > 0) {
    customerPayBtn.disabled = false;
  }

  // Fetch balance
  socket.emit('request-balance', { uid });

  // Update status
  statusDisplay.innerHTML = `
    <div class="data-row">
      <span class="data-label">Card ID:</span>
      <span class="data-value">${uid}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Balance:</span>
      <span class="data-value">Fetching...</span>
    </div>
    <div class="data-row">
      <span class="data-label">Status:</span>
      <span class="data-value" style="color: #28A745;">✓ Active</span>
    </div>
  `;

  clearResponses();
});

// Top-up success
socket.on('topup-success', (data) => {
  const { uid, amount, newBalance } = data;
  addLog(`✓ Top-up: +$${amount.toFixed(2)} | Balance: $${newBalance.toFixed(2)}`);

  if (uid === lastScannedUid) {
    lastScannedBalance = newBalance;
    cardBalanceDisplay.textContent = `$${newBalance.toFixed(2)}`;
    adminCurrentBalance.value = `$${newBalance.toFixed(2)}`;
    cardVisual.style.transform = 'scale(1.05)';
    setTimeout(() => { cardVisual.style.transform = ''; }, 300);
  }

  adminResponse.className = 'response-message success';
  adminResponse.innerHTML = `✓ Top-up Successful<br>+$${amount.toFixed(2)}<br>New Balance: $${newBalance.toFixed(2)}`;
  adminAmount.value = '';

  transactionStats.total++;
  transactionStats.success++;
  updateStats();
});

// Payment success
socket.on('payment-success', (data) => {
  const { uid, amount, newBalance } = data;
  addLog(`✓ Payment: -$${amount.toFixed(2)} | Balance: $${newBalance.toFixed(2)}`);

  if (uid === lastScannedUid) {
    lastScannedBalance = newBalance;
    cardBalanceDisplay.textContent = `$${newBalance.toFixed(2)}`;
    customerCurrentBalance.value = `$${newBalance.toFixed(2)}`;
    cardVisual.style.transform = 'scale(1.05)';
    setTimeout(() => { cardVisual.style.transform = ''; }, 300);
  }

  customerResponse.className = 'response-message success';
  customerResponse.innerHTML = `✓ Payment Approved<br>-$${amount.toFixed(2)}<br>New Balance: $${newBalance.toFixed(2)}`;
  customerQuantity.value = '1';
  customerTotalCost.value = '$0.00';

  transactionStats.total++;
  transactionStats.success++;
  updateStats();
});

// Payment declined
socket.on('payment-declined', (data) => {
  const { uid, reason, required, available } = data;
  addLog(`✗ Payment declined: ${reason}`);

  customerResponse.className = 'response-message error';
  customerResponse.innerHTML = `✗ Payment Declined<br>${reason}<br>Required: $${required.toFixed(2)} | Available: $${available.toFixed(2)}`;

  transactionStats.total++;
  transactionStats.failed++;
  updateStats();
});

// Products received
socket.on('products-response', (data) => {
  if (data.success) {
    products = data.products;
    console.log('Products loaded:', products.length);
    console.log('Products grid element:', document.getElementById('products-grid'));
    
    // Try to populate immediately
    populateProductList();
    
    // Also try after a short delay in case DOM isn't ready
    setTimeout(() => {
      console.log('Attempting delayed populate');
      populateProductList();
    }, 500);
    
    addLog(`✓ Loaded ${products.length} products`);
  } else {
    console.error('Failed to load products:', data.error);
    addLog(`✗ Failed to load products`);
  }
});

// Balance response
socket.on('balance-response', (data) => {
  if (data.success && data.uid === lastScannedUid) {
    const balance = data.balance !== null ? data.balance : 0;
    lastScannedBalance = balance;

    cardBalanceDisplay.textContent = `$${balance.toFixed(2)}`;
    adminCurrentBalance.value = `$${balance.toFixed(2)}`;
    customerCurrentBalance.value = `$${balance.toFixed(2)}`;

    const statusRow = statusDisplay.querySelector('.data-row:nth-child(2)');
    if (statusRow) {
      statusRow.innerHTML = `
        <span class="data-label">Balance:</span>
        <span class="data-value" style="color: #28A745;">$${balance.toFixed(2)}</span>
      `;
    }

    addLog(`📊 Balance: $${balance.toFixed(2)}`);
  }
});

// ========================================
// ADMIN HANDLERS
// ========================================
adminAmount.addEventListener('input', () => {
  if (lastScannedUid && adminAmount.value) {
    adminTopupBtn.disabled = false;
  } else {
    adminTopupBtn.disabled = true;
  }
});

adminTopupBtn.addEventListener('click', async () => {
  const amount = parseFloat(adminAmount.value);

  if (!lastScannedUid || !amount || amount <= 0) {
    adminResponse.className = 'response-message error';
    adminResponse.textContent = '✗ Please enter a valid amount';
    return;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: lastScannedUid, amount })
    });

    const result = await response.json();
    if (!result.success) {
      adminResponse.className = 'response-message error';
      adminResponse.textContent = `✗ Error: ${result.error}`;
      addLog(`❌ Top-up failed: ${result.error}`);
    }
  } catch (error) {
    adminResponse.className = 'response-message error';
    adminResponse.textContent = `✗ Connection error`;
    addLog(`❌ Top-up error: ${error.message}`);
  }
});

// ========================================
// CUSTOMER HANDLERS
// ========================================
function populateProductList() {
  if (!productsGrid) {
    console.error('Products grid not found');
    return;
  }
  
  
  console.log('Populating products:', products.length);
  productsGrid.innerHTML = '';
  
  if (products.length === 0) {
    productsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">No products available</div>';
    return;
  }
  
  products.forEach(product => {
    const productCard = document.createElement('div');
    productCard.className = 'product-card';
    productCard.dataset.productId = product._id;
    
    productCard.innerHTML = `
      <div class="product-image">${product.emoji || '📦'}</div>
      <div class="product-info">
        <div class="product-name">${product.name}</div>
        <div class="product-price">$$${product.price.toFixed(2)}</div>
        <div class="product-stock">In Stock</div>
      </div>
    `;
    
    productCard.addEventListener('click', () => addToCart(product));
    productsGrid.appendChild(productCard);
  });
}

function addToCart(product) {
  const existingItem = cart.find(item => item._id === product._id);
  
  if (existingItem) {
    existingItem.quantity++;
  } else {
    cart.push({
      ...product,
      quantity: 1
    });
  }
  
  renderCart();
  updateCartTotal();
  updatePayButtonState();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item._id !== productId);
  renderCart();
  updateCartTotal();
  updatePayButtonState();
}

function updateCartQuantity(productId, change) {
  const item = cart.find(item => item._id === productId);
  if (item) {
    item.quantity += change;
    if (item.quantity <= 0) {
      removeFromCart(productId);
    } else {
      renderCart();
      updateCartTotal();
    }
  }
}

function renderCart() {
  if (!cartItems) return;
  
  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="empty-cart">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        <p>Your cart is empty</p>
        <span>Select products to add to cart</span>
      </div>
    `;
    return;
  }
  
  cartItems.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-image">${item.emoji || '📦'}</div>
      <div class="cart-item-details">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">$${item.price.toFixed(2)} each</div>
        <div class="cart-item-quantity">
          <button class="qty-btn" onclick="updateCartQuantity('${item._id}', -1)">−</button>
          <span class="qty-value">${item.quantity}</span>
          <button class="qty-btn" onclick="updateCartQuantity('${item._id}', 1)">+</button>
        </div>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart('${item._id}')">×</button>
    </div>
  `).join('');
}

function updateCartTotal() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  if (cartSubtotal) cartSubtotal.textContent = `$${subtotal.toFixed(2)}`;
  if (cartTotal) cartTotal.textContent = `$${subtotal.toFixed(2)}`;
}

function updatePayButtonState() {
  const hasUid = !!lastScannedUid;
  const hasItems = cart.length > 0;
  
  if (customerPayBtn) {
    customerPayBtn.disabled = !(hasUid && hasItems);
  }
}

// Product search
if (productSearch) {
  productSearch.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const productCards = document.querySelectorAll('.product-card');
    
    productCards.forEach(card => {
      const productName = card.querySelector('.product-name').textContent.toLowerCase();
      if (productName.includes(searchTerm)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  });
}

// Make functions global for onclick handlers
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.updateCartQuantity = updateCartQuantity;

customerPayBtn.addEventListener('click', async () => {
  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (!lastScannedUid || cart.length === 0 || totalAmount <= 0) {
    customerResponse.className = 'response-message error';
    customerResponse.textContent = '✗ Please add items to cart';
    return;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: lastScannedUid,
        productId: cart[0]._id,
        quantity: cart.reduce((sum, item) => sum + item.quantity, 0),
        totalAmount
      })
    });

    const result = await response.json();
    if (!result.success) {
      customerResponse.className = 'response-message error';
      customerResponse.innerHTML = `✗ ${result.reason || result.error}`;
      addLog(`❌ Payment failed: ${result.reason || result.error}`);
    } else {
      // Clear cart on success
      cart = [];
      renderCart();
      updateCartTotal();
      updatePayButtonState();
    }
  } catch (error) {
    customerResponse.className = 'response-message error';
    customerResponse.textContent = `✗ Connection error`;
    addLog(`❌ Payment error: ${error.message}`);
  }
});

// ========================================
// UTILITY FUNCTIONS
// ========================================
function addLog(message) {
  const li = document.createElement('li');
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  li.textContent = `[${timeStr}] ${message}`;
  logList.prepend(li);

  // Keep only last 50 logs
  while (logList.children.length > 50) {
    logList.removeChild(logList.lastChild);
  }

  // Update transaction count
  document.getElementById('transaction-count').textContent = logList.children.length;
}

function clearResponses() {
  adminResponse.className = 'response-message';
  adminResponse.textContent = '';
  customerResponse.className = 'response-message';
  customerResponse.textContent = '';
}

function updateStats() {
  statTransactions.textContent = transactionStats.total;
  statSuccess.textContent = transactionStats.success;
  statFailed.textContent = transactionStats.failed;
}

// ========================================
// INITIALIZATION
// ========================================
addLog('Smart-Pay initialized');



