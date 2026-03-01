const express = require('express');
const mqtt = require('mqtt');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const {
  connectDB,
  getDB,
  updateWalletAtomic,
  getOrCreateWallet,
  getWalletBalance,
  getTransactionHistory,
  getProducts,
  seedProducts,
  closeDB
} = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// ========================================
// CONFIGURATION
// ========================================
const PORT = process.env.PORT || 9201;
const TEAM_ID = "iot_shield_2026";
const MQTT_BROKER = "mqtt://157.173.101.159:1883";

// MQTT Topics
const TOPICS = {
  STATUS: `rfid/${TEAM_ID}/card/status`,
  BALANCE: `rfid/${TEAM_ID}/card/balance`,
  TOPUP: `rfid/${TEAM_ID}/card/topup`,
  PAY: `rfid/${TEAM_ID}/card/pay`,
  HEALTH: `rfid/${TEAM_ID}/device/health`,
  LWT: `rfid/${TEAM_ID}/device/status`
};

let mqttClient = null;

// ========================================
// SERVE FRONTEND
// ========================================
const frontendPath = path.resolve(__dirname, '../frontend');
app.use(express.static(frontendPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ========================================
// MQTT SETUP
// ========================================
function setupMQTT() {
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: `backend_${TEAM_ID}_${Date.now()}`,
    will: {
      topic: TOPICS.LWT,
      payload: JSON.stringify({ status: 'offline', timestamp: new Date() }),
      qos: 1,
      retain: true
    }
  });

  mqttClient.on('connect', () => {
    console.log(' Connected to MQTT Broker');

    // Subscribe to all incoming topics
    const subscribes = [
      TOPICS.STATUS,
      TOPICS.BALANCE,
      TOPICS.TOPUP,
      TOPICS.PAY,
      TOPICS.HEALTH
    ];

    mqttClient.subscribe(subscribes, (err) => {
      if (!err) console.log(' Subscribed to MQTT topics');
      else console.error('MQTT subscription error:', err);
    });

    // Publish backend online status
    mqttClient.publish(
      TOPICS.LWT,
      JSON.stringify({ status: 'online', timestamp: new Date() }),
      { retain: true }
    );
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`📨 MQTT [${topic}]:`, data);

      // Handle card scans
      if (topic === TOPICS.STATUS) {
        const { uid, balance } = data;

        // Ensure wallet exists in DB
        await getOrCreateWallet(uid);

        // Broadcast to all connected clients
        io.emit('card-scanned', {
          uid,
          deviceBalance: balance,
          timestamp: new Date()
        });
      }

      // Handle payment confirmations
      if (topic === TOPICS.PAY) {
        const { uid, status, newBalance } = data;
        io.emit('payment-confirmed', {
          uid,
          status,
          newBalance,
          timestamp: new Date()
        });
      }

      // Handle balance updates
      if (topic === TOPICS.BALANCE) {
        const { uid, new_balance } = data;
        io.emit('balance-updated', {
          uid,
          newBalance: new_balance,
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('❌ MQTT message parse error:', error.message);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('❌ MQTT error:', err.message);
  });

  mqttClient.on('offline', () => {
    console.log('⚠️  MQTT connection lost');
  });
}

// ========================================
// WEBSOCKET SETUP
// ========================================
io.on('connection', (socket) => {
  console.log(` WebSocket client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(` WebSocket client disconnected: ${socket.id}`);
  });

  // Client requests current balance
  socket.on('request-balance', async (data) => {
    try {
      const { uid } = data;
      const balance = await getWalletBalance(uid);
      socket.emit('balance-response', { uid, balance, success: true });
    } catch (error) {
      socket.emit('balance-response', { success: false, error: error.message });
    }
  });

  // Client requests products
  socket.on('request-products', async () => {
    try {
      const products = await getProducts();
      socket.emit('products-response', { products, success: true });
    } catch (error) {
      socket.emit('products-response', { success: false, error: error.message });
    }
  });

  // Client requests transaction history
  socket.on('request-history', async (data) => {
    try {
      const { uid, limit } = data;
      const transactions = await getTransactionHistory(uid, limit || 10);
      socket.emit('history-response', { uid, transactions, success: true });
    } catch (error) {
      socket.emit('history-response', { success: false, error: error.message });
    }
  });
});

// ========================================
// HTTP API ENDPOINTS
// ========================================

/**
 * GET /balance/:uid
 * Retrieve wallet balance for a specific card
 */
app.get('/balance/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({ success: false, error: 'UID required' });
    }

    // Ensure wallet exists
    const wallet = await getOrCreateWallet(uid);

    res.json({
      success: true,
      uid,
      balance: wallet.balance,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /topup
 * Add balance to a card (Admin action)
 * 
 * Request body:
 * {
 *   "uid": "A1B2C3D4",
 *   "amount": 1000
 * }
 */
app.post('/topup', async (req, res) => {
  try {
    const { uid, amount } = req.body;

    // Validation
    if (!uid || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid UID or amount'
      });
    }

    // Ensure wallet exists
    await getOrCreateWallet(uid);

    // Perform atomic wallet update
    const result = await updateWalletAtomic(uid, amount, 'TOPUP', 'Admin top-up');

    if (!result.success) {
      return res.status(400).json(result);
    }

    console.log(`✓ Top-up successful: ${uid} +${amount}`);

    // Publish to MQTT for device confirmation
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(
        TOPICS.TOPUP,
        JSON.stringify({
          uid,
          amount,
          previousBalance: result.previousBalance,
          newBalance: result.newBalance,
          timestamp: new Date()
        })
      );
    }

    // Broadcast to all WebSocket clients
    io.emit('topup-success', {
      uid,
      amount,
      previousBalance: result.previousBalance,
      newBalance: result.newBalance,
      timestamp: result.timestamp
    });

    res.json(result);
  } catch (error) {
    console.error('❌ Top-up error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /pay
 * Deduct balance from a card (Cashier action)
 * 
 * Request body:
 * {
 *   "uid": "A1B2C3D4",
 *   "productId": "123",
 *   "quantity": 2,
 *   "totalAmount": 1000
 * }
 */
app.post('/pay', async (req, res) => {
  try {
    const { uid, productId, quantity, totalAmount } = req.body;

    // Validation
    if (!uid || !totalAmount || totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid UID or amount'
      });
    }

    // Ensure wallet exists
    await getOrCreateWallet(uid);

    // Get current balance
    const wallet = await getWalletBalance(uid);

    // Check sufficient balance
    if (wallet < totalAmount) {
      // Log failed transaction
      await updateWalletAtomic(
        uid,
        0,
        'PAYMENT',
        `Failed: Insufficient balance. Required: ${totalAmount}, Available: ${wallet}`
      );

      console.log(`❌ Payment declined: ${uid} - Insufficient balance`);

      io.emit('payment-declined', {
        uid,
        reason: 'Insufficient balance',
        required: totalAmount,
        available: wallet,
        timestamp: new Date()
      });

      return res.status(400).json({
        success: false,
        reason: 'Insufficient balance',
        required: totalAmount,
        available: wallet
      });
    }

    // Perform atomic wallet update (deduct = negative amount)
    const result = await updateWalletAtomic(
      uid,
      -totalAmount,
      'PAYMENT',
      `Product: ${productId}, Qty: ${quantity}`
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    console.log(`✓ Payment successful: ${uid} -${totalAmount}`);

    // Publish to MQTT for device confirmation
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(
        TOPICS.PAY,
        JSON.stringify({
          uid,
          amount: totalAmount,
          previousBalance: result.previousBalance,
          newBalance: result.newBalance,
          status: 'approved',
          timestamp: new Date()
        })
      );
    }

    // Broadcast to all WebSocket clients
    io.emit('payment-success', {
      uid,
      amount: totalAmount,
      previousBalance: result.previousBalance,
      newBalance: result.newBalance,
      productId,
      quantity,
      timestamp: result.timestamp
    });

    res.json({
      success: true,
      uid,
      amount: totalAmount,
      previousBalance: result.previousBalance,
      newBalance: result.newBalance,
      status: 'approved',
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('❌ Payment error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /products
 * Retrieve all active products
 */
app.get('/products', async (req, res) => {
  try {
    const products = await getProducts();
    res.json({
      success: true,
      products
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /products/reseed
 * Force reseed products (for development)
 */
app.post('/products/reseed', async (req, res) => {
  try {
    const db = getDB();
    // Clear existing products
    await db.collection('products').deleteMany({});
    // Reseed
    await seedProducts();
    const products = await getProducts();
    res.json({
      success: true,
      message: `Reseeded ${products.length} products`,
      products
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /transactions/:uid
 * Get transaction history for a card
 */
app.get('/transactions/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const { limit } = req.query;

    const transactions = await getTransactionHistory(uid, parseInt(limit) || 10);

    res.json({
      success: true,
      uid,
      transactions,
      count: transactions.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// INITIALIZATION & STARTUP
// ========================================
async function startup() {
  try {
    // Connect to MongoDB
    console.log('\n🔄 Initializing Smart-Pay Backend...\n');
    await connectDB();

    // Seed default products
    await seedProducts();

    // Setup MQTT
    setupMQTT();

    // Start HTTP server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n✓ Server running on http://localhost:${PORT}`);
      console.log(`✓ Team ID: ${TEAM_ID}`);
      console.log(`✓ MQTT Broker: ${MQTT_BROKER}\n`);
    });
  } catch (error) {
    console.error('❌ Startup failed:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n Shutting down gracefully...');

  if (mqttClient) {
    mqttClient.end();
    console.log('MQTT disconnected');
  }

  await closeDB();
  process.exit(0);
});

// Start the server
startup();

module.exports = { app, server };
