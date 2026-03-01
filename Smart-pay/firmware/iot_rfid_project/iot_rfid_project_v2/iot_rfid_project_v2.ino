#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <time.h>

// ==========================================
// WiFi CONFIGURATION
// ==========================================
const char *ssid = "RCA";
const char *password = "@RcaNyabihu2023";
const uint32_t WIFI_TIMEOUT_MS = 30000;

// ==========================================
// MQTT CONFIGURATION
// ==========================================
const char *mqtt_server = "broker.benax.rw";
const uint16_t MQTT_PORT = 1883;
const char *team_id = "iot_shield_2026";

// MQTT Topics
String topic_status = String("rfid/") + String(team_id) + "/card/status";
String topic_balance = String("rfid/") + String(team_id) + "/card/balance";
String topic_topup = String("rfid/") + String(team_id) + "/card/topup";
String topic_pay = String("rfid/") + String(team_id) + "/card/pay";
String topic_health = String("rfid/") + String(team_id) + "/device/health";
String topic_lwt = String("rfid/") + String(team_id) + "/device/status";

// ==========================================
// PIN MAPPING
// ==========================================
#define RST_PIN D3
#define SS_PIN D4

MFRC522 mfrc522(SS_PIN, RST_PIN);
WiFiClient espClient;
PubSubClient client(espClient);

// ==========================================
// GLOBAL STATE
// ==========================================
unsigned long last_health_report = 0;
const unsigned long HEALTH_INTERVAL = 60000; // 60 seconds
unsigned long last_card_scan = 0;
const unsigned long CARD_DEBOUNCE = 2000; // 2 seconds

// ==========================================
// TIME FUNCTIONS
// ==========================================
void sync_time()
{
    Serial.print("Syncing time with NTP...");
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");

    time_t now = time(nullptr);
    int timeout = 0;
    while (now < 8 * 3600 * 2 && timeout < 20)
    {
        delay(500);
        Serial.print(".");
        now = time(nullptr);
        timeout++;
    }
    Serial.println("\nTime synchronized");
}

unsigned long get_unix_time()
{
    return (unsigned long)time(nullptr);
}

// ==========================================
// WiFi SETUP
// ==========================================
void setup_wifi()
{
    delay(10);
    Serial.println();
    Serial.print("Connecting to WiFi: ");
    Serial.println(ssid);

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    unsigned long start_attempt_ms = millis();
    int dot_count = 0;

    while (WiFi.status() != WL_CONNECTED)
    {
        if (millis() - start_attempt_ms > WIFI_TIMEOUT_MS)
        {
            Serial.println("\n WiFi connection timeout! Restarting...");
            delay(1000);
            ESP.restart();
        }
        delay(500);
        Serial.print(".");
        dot_count++;
        if (dot_count > 20)
        {
            Serial.println();
            dot_count = 0;
        }
    }

    Serial.println("\n✓ WiFi connected");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
}

// ==========================================
// MQTT CALLBACK (Commands from Backend)
// ==========================================
void callback(char *topic, byte *payload, unsigned int length)
{
    Serial.print(" Message arrived [");
    Serial.print(topic);
    Serial.print("] ");

    char json_str[512];
    if (length >= 512)
    {
        Serial.println(" Payload too large!");
        return;
    }

    memcpy(json_str, payload, length);
    json_str[length] = '\0';

    Serial.println(json_str);

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, json_str);

    if (error)
    {
        Serial.print("JSON parse error: ");
        Serial.println(error.c_str());
        return;
    }

    // Handle TOP-UP command
    if (String(topic) == topic_topup)
    {
        const char *uid = doc["uid"];
        double amount = doc["amount"];
        double newBalance = doc["newBalance"];

        Serial.print("✓ Top-up command received: ");
        Serial.print(uid);
        Serial.print(" | +");
        Serial.println(newBalance);
    }

    // Handle PAYMENT command
    if (String(topic) == topic_pay)
    {
        const char *uid = doc["uid"];
        const char *status = doc["status"];
        double newBalance = doc["newBalance"];

        Serial.print("✓ Payment confirmation: ");
        Serial.print(uid);
        Serial.print(" | Status: ");
        Serial.print(status);
        Serial.print(" | New Balance: ");
        Serial.println(newBalance);
    }
}

// ==========================================
// MQTT RECONNECT
// ==========================================
void reconnect()
{
    int attempt = 0;
    while (!client.connected() && attempt < 5)
    {
        Serial.print("Attempting MQTT connection (");
        Serial.print(attempt + 1);
        Serial.print("/5)...");

        String clientId = "ESP8266_" + String(team_id) + "_" + String(ESP.getChipId(), HEX);

        if (client.connect(clientId.c_str(), topic_lwt.c_str(), 1, true, "offline"))
        {
            Serial.println(" ✓ connected");

            client.publish(topic_lwt.c_str(), "online", true);
            client.subscribe(topic_topup.c_str());
            client.subscribe(topic_pay.c_str());

            Serial.println("✓ Subscribed to command topics");
        }
        else
        {
            Serial.print("  failed, rc=");
            Serial.print(client.state());
            Serial.println(" trying again in 5 seconds");
            delay(5000);
            attempt++;
        }
    }
}

// ==========================================
// HEALTH REPORTING
// ==========================================
void publish_health()
{
    StaticJsonDocument<256> doc;
    doc["status"] = "online";
    doc["device"] = "ESP8266_RFID";
    doc["team"] = team_id;
    doc["ip"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["ts"] = get_unix_time();

    char buffer[256];
    serializeJson(doc, buffer);
    client.publish(topic_health.c_str(), buffer);

    Serial.println(" Health report published");
}

// ==========================================
// CARD SCAN PUBLISHING
// ==========================================
void publish_card_scan(String uid)
{
    double currentBalance = 50.0; // Simulated

    StaticJsonDocument<256> doc;
    doc["uid"] = uid;
    doc["balance"] = currentBalance;
    doc["status"] = "detected";
    doc["device"] = "ESP8266_RFID";
    doc["ts"] = get_unix_time();

    char buffer[256];
    serializeJson(doc, buffer);

    if (client.publish(topic_status.c_str(), buffer))
    {
        Serial.println(" Card status published to MQTT");
    }
    else
    {
        Serial.println(" Failed to publish card status");
    }
}

// ==========================================
// SETUP
// ==========================================
void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n\n");
    Serial.println("=====================================");
    Serial.println("  Smart-Pay RFID Module");
    Serial.println("  Team: iot_shield_2026");
    Serial.println("=====================================\n");

    SPI.begin();
    mfrc522.PCD_Init();
    mfrc522.PCD_DumpVersionToSerial();

    setup_wifi();
    sync_time();

    client.setServer(mqtt_server, MQTT_PORT);
    client.setCallback(callback);

    Serial.println("✓ System initialized successfully\n");
}

// ==========================================
// MAIN LOOP
// ==========================================
void loop()
{
    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println("  WiFi disconnected, reconnecting...");
        setup_wifi();
    }

    if (!client.connected())
    {
        reconnect();
    }

    client.loop();

    unsigned long now = millis();
    if (now - last_health_report > HEALTH_INTERVAL)
    {
        last_health_report = now;
        publish_health();
    }

    // RFID Card Scanning
    if (now - last_card_scan > CARD_DEBOUNCE)
    {
        if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial())
        {
            String uid = "";
            for (byte i = 0; i < mfrc522.uid.size; i++)
            {
                if (mfrc522.uid.uidByte[i] < 0x10)
                    uid += "0";
                uid += String(mfrc522.uid.uidByte[i], HEX);
            }
            uid.toUpperCase();

            Serial.println("=====================================");
            Serial.println(" Card Detected!");
            Serial.print("UID: ");
            Serial.println(uid);
            Serial.println("=====================================");

            publish_card_scan(uid);
            last_card_scan = now;

            mfrc522.PICC_HaltA();
            mfrc522.PCD_StopCrypto1();
        }
    }

    delay(100);
}
