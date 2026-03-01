const { MongoClient } = require('mongodb');
require('dotenv').config();

// MongoDB connection - Using local MongoDB for development
// For production, set MONGODB_URI in .env file
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/";
const DB_NAME = "smartpay";

let client = null;
let db = null;

// Initialize MongoDB connection
async function connectDB() {
    try {
        client = new MongoClient(MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 5
        });

        await client.connect();
        db = client.db(DB_NAME);

        console.log(" Connected to MongoDB Atlas");

        // Initialize collections with indexes
        await initializeCollections();

        return db;
    } catch (error) {
        console.error("✗ MongoDB connection failed:", error.message);
        process.exit(1);
    }
}

// Initialize collections and create indexes
async function initializeCollections() {
    try {
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        // Create collections if they don't exist
        if (!collectionNames.includes('cards')) {
            await db.createCollection('cards');
            await db.collection('cards').createIndex({ uid: 1 }, { unique: true });
            console.log("✓ Created 'cards' collection");
        }

        if (!collectionNames.includes('wallets')) {
            await db.createCollection('wallets');
            await db.collection('wallets').createIndex({ cardUid: 1 }, { unique: true });
            console.log("✓ Created 'wallets' collection");
        }

        if (!collectionNames.includes('products')) {
            await db.createCollection('products');
            console.log("✓ Created 'products' collection");
        }

        if (!collectionNames.includes('transactions')) {
            await db.createCollection('transactions');
            await db.collection('transactions').createIndex({ cardUid: 1 });
            await db.collection('transactions').createIndex({ createdAt: 1 });
            console.log("✓ Created 'transactions' collection");
        }

    } catch (error) {
        console.error("Collection initialization error:", error.message);
    }
}

// Get database instance
function getDB() {
    if (!db) {
        throw new Error("Database not connected. Call connectDB() first");
    }
    return db;
}

// Get MongoDB client
function getClient() {
    if (!client) {
        throw new Error("MongoDB client not initialized");
    }
    return client;
}

// Safe wallet update with atomic transaction
async function updateWalletAtomic(cardUid, amount, transactionType, reason = null) {
    const session = client.startSession();

    try {
        const result = await session.withTransaction(async () => {
            const walletCollection = db.collection('wallets');
            const transactionCollection = db.collection('transactions');

            // 1. Get current wallet
            const wallet = await walletCollection.findOne({ cardUid });

            if (!wallet) {
                throw new Error(`Wallet not found for card ${cardUid}`);
            }

            const previousBalance = wallet.balance;
            const newBalance = previousBalance + amount;

            // Prevent negative balance on payment
            if (transactionType === 'PAYMENT' && newBalance < 0) {
                throw new Error('Insufficient balance');
            }

            // 2. Update wallet
            await walletCollection.updateOne(
                { cardUid },
                {
                    $set: {
                        balance: newBalance,
                        updatedAt: new Date()
                    }
                },
                { session }
            );

            // 3. Record transaction
            const transaction = {
                cardUid,
                type: transactionType,
                amount: Math.abs(amount),
                previousBalance,
                newBalance,
                status: 'SUCCESS',
                reason,
                createdAt: new Date()
            };

            const txResult = await transactionCollection.insertOne(transaction, { session });

            return {
                success: true,
                cardUid,
                previousBalance,
                newBalance,
                transactionId: txResult.insertedId,
                timestamp: new Date()
            };
        });

        return result;
    } catch (error) {
        // Transaction automatically aborted on error
        return {
            success: false,
            error: error.message,
            cardUid
        };
    } finally {
        await session.endSession();
    }
}

// Get or create wallet for a card
async function getOrCreateWallet(cardUid) {
    try {
        const walletCollection = db.collection('wallets');
        const cardsCollection = db.collection('cards');

        // Check if card exists
        let card = await cardsCollection.findOne({ uid: cardUid });
        if (!card) {
            // Create new card
            await cardsCollection.insertOne({
                uid: cardUid,
                owner: null,
                createdAt: new Date()
            });
        }

        // Get or create wallet
        let wallet = await walletCollection.findOne({ cardUid });
        if (!wallet) {
            const result = await walletCollection.insertOne({
                cardUid,
                balance: 0,
                updatedAt: new Date()
            });
            wallet = {
                _id: result.insertedId,
                cardUid,
                balance: 0,
                updatedAt: new Date()
            };
        }

        return wallet;
    } catch (error) {
        throw new Error(`Failed to get/create wallet: ${error.message}`);
    }
}

// Get wallet balance
async function getWalletBalance(cardUid) {
    try {
        const wallet = await db.collection('wallets').findOne({ cardUid });
        return wallet ? wallet.balance : null;
    } catch (error) {
        throw new Error(`Failed to fetch balance: ${error.message}`);
    }
}

// Get transaction history
async function getTransactionHistory(cardUid, limit = 10) {
    try {
        const transactions = await db.collection('transactions')
            .find({ cardUid })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return transactions;
    } catch (error) {
        throw new Error(`Failed to fetch transactions: ${error.message}`);
    }
}

// Get all products
async function getProducts() {
    try {
        const products = await db.collection('products')
            .find({ active: true })
            .toArray();
        return products;
    } catch (error) {
        throw new Error(`Failed to fetch products: ${error.message}`);
    }
}

// Seed default products (Transport & Buy)
async function seedProducts() {
    try {
        const productsCollection = db.collection('products');
        const count = await productsCollection.countDocuments();

        if (count === 0) {
            const defaultProducts = [
                // Food Items
                {
                    name: "Coffee",
                    price: 5.99,
                    emoji: "☕",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Sandwich",
                    price: 8.50,
                    emoji: "🥪",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Pizza",
                    price: 12.99,
                    emoji: "🍕",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Burger",
                    price: 10.50,
                    emoji: "🍔",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Salad",
                    price: 7.99,
                    emoji: "🥗",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Sushi",
                    price: 15.99,
                    emoji: "🍱",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Juice",
                    price: 4.50,
                    emoji: "🧃",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Ice Cream",
                    price: 6.50,
                    emoji: "🍦",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Donut",
                    price: 3.99,
                    emoji: "🍩",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Cake",
                    price: 9.99,
                    emoji: "🍰",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Fries",
                    price: 4.99,
                    emoji: "🍟",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Taco",
                    price: 8.99,
                    emoji: "🌮",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                // Additional Items
                {
                    name: "Hot Dog",
                    price: 6.99,
                    emoji: "🌭",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Pasta",
                    price: 11.99,
                    emoji: "🍝",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Ramen",
                    price: 13.50,
                    emoji: "🍜",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Smoothie",
                    price: 6.99,
                    emoji: "🥤",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Croissant",
                    price: 4.50,
                    emoji: "🥐",
                    category: "Bakery",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Bagel",
                    price: 3.99,
                    emoji: "🥯",
                    category: "Bakery",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Waffle",
                    price: 7.50,
                    emoji: "🧇",
                    category: "Breakfast",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Pancakes",
                    price: 8.99,
                    emoji: "🥞",
                    category: "Breakfast",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Burrito",
                    price: 9.99,
                    emoji: "🌯",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Popcorn",
                    price: 3.50,
                    emoji: "🍿",
                    category: "Snacks",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Cookie",
                    price: 2.99,
                    emoji: "🍪",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Cupcake",
                    price: 4.50,
                    emoji: "🧁",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                // More Products
                {
                    name: "Steak",
                    price: 24.99,
                    emoji: "🥩",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Chicken",
                    price: 14.99,
                    emoji: "🍗",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Shrimp",
                    price: 18.99,
                    emoji: "🍤",
                    category: "Food",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Bacon",
                    price: 5.99,
                    emoji: "🥓",
                    category: "Breakfast",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Eggs",
                    price: 4.99,
                    emoji: "🍳",
                    category: "Breakfast",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Bread",
                    price: 3.50,
                    emoji: "🍞",
                    category: "Bakery",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Cheese",
                    price: 6.50,
                    emoji: "🧀",
                    category: "Dairy",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Milk",
                    price: 3.99,
                    emoji: "🥛",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Tea",
                    price: 4.50,
                    emoji: "🍵",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Soda",
                    price: 2.99,
                    emoji: "🥤",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Water",
                    price: 1.99,
                    emoji: "💧",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Wine",
                    price: 19.99,
                    emoji: "🍷",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Beer",
                    price: 6.99,
                    emoji: "🍺",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Cocktail",
                    price: 12.99,
                    emoji: "🍹",
                    category: "Beverages",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Chips",
                    price: 3.99,
                    emoji: "🥔",
                    category: "Snacks",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Pretzel",
                    price: 4.50,
                    emoji: "🥨",
                    category: "Snacks",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Nachos",
                    price: 7.99,
                    emoji: "🧀",
                    category: "Snacks",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Pie",
                    price: 8.99,
                    emoji: "🥧",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Chocolate",
                    price: 4.99,
                    emoji: "🍫",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Candy",
                    price: 2.50,
                    emoji: "🍬",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Lollipop",
                    price: 1.99,
                    emoji: "🍭",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Pudding",
                    price: 5.50,
                    emoji: "🍮",
                    category: "Desserts",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Honey",
                    price: 7.99,
                    emoji: "🍯",
                    category: "Condiments",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Apple",
                    price: 2.50,
                    emoji: "🍎",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Banana",
                    price: 1.99,
                    emoji: "🍌",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Orange",
                    price: 2.99,
                    emoji: "🍊",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Watermelon",
                    price: 8.99,
                    emoji: "🍉",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Grapes",
                    price: 5.99,
                    emoji: "🍇",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Strawberry",
                    price: 6.50,
                    emoji: "🍓",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Peach",
                    price: 3.99,
                    emoji: "🍑",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                },
                {
                    name: "Pineapple",
                    price: 7.50,
                    emoji: "🍍",
                    category: "Fruits",
                    active: true,
                    createdAt: new Date()
                }
            ];

            await productsCollection.insertMany(defaultProducts);
            console.log(`✓ Default products seeded (${defaultProducts.length} items)`);
        }
    } catch (error) {
        console.error("Product seeding error:", error.message);
    }
}

// Close database connection
async function closeDB() {
    if (client) {
        await client.close();
        console.log("✓ Database connection closed");
    }
}

module.exports = {
    connectDB,
    getDB,
    getClient,
    updateWalletAtomic,
    getOrCreateWallet,
    getWalletBalance,
    getTransactionHistory,
    getProducts,
    seedProducts,
    closeDB
};
