# Smart-Pay RFID Wallet System

A complete RFID-based digital wallet system with real-time web dashboard, atomic database transactions, and edge device integration via MQTT.

## 🎯 System Overview

Smart-Pay enables contactless payments and top-ups using RFID cards with a modern web dashboard supporting both Admin (top-up) and Cashier (payment) interfaces.

## 📋 Features Implemented

### 1. RFID Wallet System
- **Unique Card UIDs**: Each RFID card has a unique identifier
- **Balance Tracking**: Real-time wallet balance per card
- **Atomic Transactions**: Top-up and payment operations are atomic
- **Transaction Ledger**: Complete audit trail

### 2. Backend API (Express.js + MongoDB)
- **POST /topup**: Add balance to a card
- **POST /pay**: Deduct balance for payment
- **GET /balance/:uid**: Check current balance
- **GET /products**: Retrieve available products
- **GET /transactions/:uid**: View transaction history

### 3. Dashboard Features
- **Dual Interface**: Admin (top-up) & Cashier (payment)
- **Real-time WebSocket**: No polling - instant updates
- **Auto-Detection**: RFID cards detected automatically
- **Atomic Transactions**: MongoDB sessions ensure data integrity

### 4. MongoDB Atlas Integration
- **Atomic Operations**: Wallet update + transaction saved together
- **4 Collections**: cards, wallets, products, transactions
- **Immutable Ledger**: Prevents fraud and data corruption

### 5. MQTT Communication
- **Isolated Topics**: `rfid/iot_shield_2026/card/*`
- **Device Commands**: Top-up and payment confirmations
- **Health Monitoring**: Device status tracking

## 🚀 Quick Setup

### Backend
```bash
cd backend
npm install
NODE CONFIGURATION:
- Update MONGODB_URI in database.js
- Update MQTT_BROKER in server.js
npm run dev
# Runs on http://localhost:9201
```

### Frontend
- Open http://localhost:9201
- Switch between Admin and Cashier modes

### ESP8266 Firmware
1. Use firmware/iot_rfid_project/iot_rfid_project_v2.ino
2. Update WiFi & MQTT settings
3. Install: MFRC522, PubSubClient, ArduinoJson
4. Upload to ESP8266

### Hardware Wiring (ESP8266 + RC522)
| RC522 | ESP8266 |
|-------|---------|
| 3.3V  | 3V3     |
| GND   | GND     |
| RST   | D3      |
| SDA   | D4      |
| MOSI  | D7      |
| MISO  | D6      |
| SCK   | D5      |

## 💾 Database Schema

**cards**: `{uid, owner, createdAt}`  
**wallets**: `{cardUid, balance, updatedAt}`  
**products**: `{name, price, active}`  
**transactions**: `{cardUid, type, amount, previousBalance, newBalance, status, reason, createdAt}`

## 🔌 MQTT Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `card/status` | ESP→Backend | Card scan detection |
| `card/topup` | Backend→ESP | Top-up commands |
| `card/pay` | Backend→ESP | Payment confirmation |
| `device/health` | ESP→Backend | Health metrics |
| `device/status` | LWT | Online/offline |

## ✨ Key Features

✅ Atomic transactions (MongoDB sessions)  
✅ Double-spend prevention  
✅ Real-time WebSocket (no polling)  
✅ Clean architecture separation  
✅ Team isolation (MQTT namespacing)  
✅ Immutable audit trail  
✅ Dual dashboard roles  

## 🛠 Project Structure

```
Smart-pay/
├── backend/
│   ├── database.js
│   ├── server.js
│   └── package.json
├── firmware/
│   └── iot_rfid_project/
│       └── iot_rfid_project_v2.ino
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── README.md
```

## 📝 Team ID: iot_shield_2026

**Status**: Production Ready | **Updated**: February 2026

### Live url
**http://157.173.101.159:9201/**
