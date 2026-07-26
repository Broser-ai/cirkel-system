/*
 * Cirkel System - Modul 5.4
 * ESP32 Smart-Container Firmware
 *
 * Hardware:
 *   - ESP32 WROOM-32 (dev board)
 *   - HX711 24-bit ADC + load cell (weight)
 *   - HC-SR04 ultrasonic sensor (fill level)
 *   - LiPo 3.7V battery via TP4056
 *
 * Behaviour:
 *   Wake -> stabilize sensors -> read weight (median-of-5) + distance ->
 *   if delta > 5g POST /api/bins/ingest -> deep sleep.
 *
 * Author: Cirkel Hardware Team
 * Target: Arduino IDE 2.x, board = "ESP32 Dev Module"
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HX711.h>
#include <ArduinoJson.h>
#include <esp_sleep.h>

// ---------- Pin configuration ----------
#define LOADCELL_DOUT_PIN   21
#define LOADCELL_SCK_PIN    22
#define ULTRASONIC_TRIG     5
#define ULTRASONIC_ECHO     18
#define STATUS_LED          2

// ---------- Runtime constants ----------
static const char*  WIFI_SSID        = "CIRKEL_FIELD";
static const char*  WIFI_PASSWORD    = "REPLACE_ME";
static const char*  API_ENDPOINT     = "https://api.cirkel.dk/api/bins/ingest";
static const char*  BEARER_TOKEN     = "REPLACE_WITH_ROTATED_TOKEN"; // rotate every 90 days
static const char*  BIN_ID           = "BIN-0001";

static const float  WEIGHT_DELTA_G   = 5.0f;   // trigger threshold
static const float  CALIBRATION_FACTOR = 420.0f;
static const uint32_t HTTP_TIMEOUT_MS = 5000;
static const uint8_t  HTTP_MAX_RETRIES = 3;
static const uint64_t SLEEP_US        = 60ULL * 1000000ULL; // 60s

// Fixed GPS coordinates (replace with GPS module reading in field units).
static const float DEFAULT_LAT = 56.1629f;
static const float DEFAULT_LON = 10.2039f;

// ---------- Persistent state across deep-sleep ----------
RTC_DATA_ATTR float lastReportedWeight = 0.0f;

// ---------- Globals ----------
HX711 scale;

// ---------- Helpers ----------
float readDistanceCm() {
  digitalWrite(ULTRASONIC_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIG, LOW);
  long duration = pulseIn(ULTRASONIC_ECHO, HIGH, 30000UL);
  if (duration == 0) return -1.0f;
  return (duration * 0.0343f) / 2.0f;
}

float readWeightMedian5() {
  float samples[5];
  for (uint8_t i = 0; i < 5; i++) {
    samples[i] = scale.get_units(3); // 3 internal averages per sample
    delay(80);
  }
  // simple insertion sort
  for (uint8_t i = 1; i < 5; i++) {
    float key = samples[i];
    int8_t j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }
  return samples[2]; // median
}

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - started > 15000) return false;
    delay(200);
  }
  return true;
}

bool postIngest(float addedGrams, float depthCm) {
  StaticJsonDocument<256> doc;
  doc["bin_id"] = BIN_ID;
  doc["added_weight_grams"] = addedGrams;
  doc["latitude"] = DEFAULT_LAT;
  doc["longitude"] = DEFAULT_LON;
  doc["volumetric_depth_cm"] = depthCm;

  String payload;
  serializeJson(doc, payload);

  WiFiClientSecure client;
  client.setInsecure(); // TLS 1.3 handled by underlying stack; pin certs in prod
  // client.setCACert(rootCa); // enable when cert pinning is ready

  for (uint8_t attempt = 1; attempt <= HTTP_MAX_RETRIES; attempt++) {
    HTTPClient https;
    https.setTimeout(HTTP_TIMEOUT_MS);
    if (!https.begin(client, API_ENDPOINT)) {
      Serial.printf("[HTTP] begin failed (try %u)\n", attempt);
      delay(500 * attempt);
      continue;
    }
    https.addHeader("Content-Type", "application/json");
    https.addHeader("Authorization", String("Bearer ") + BEARER_TOKEN);

    int code = https.POST(payload);
    Serial.printf("[HTTP] attempt %u -> %d\n", attempt, code);
    https.end();

    if (code >= 200 && code < 300) return true;
    delay(500 * attempt); // linear back-off
  }
  return false;
}

void goToDeepSleep() {
  Serial.println("[SLEEP] entering deep sleep");
  Serial.flush();
  esp_sleep_enable_timer_wakeup(SLEEP_US);
  esp_deep_sleep_start();
}

// ---------- Arduino entry points ----------
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n[BOOT] Cirkel ESP32 firmware");

  pinMode(STATUS_LED, OUTPUT);
  pinMode(ULTRASONIC_TRIG, OUTPUT);
  pinMode(ULTRASONIC_ECHO, INPUT);

  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();

  if (!connectWiFi()) {
    Serial.println("[WIFI] connect failed - sleeping");
    goToDeepSleep();
  }
  Serial.printf("[WIFI] connected: %s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  digitalWrite(STATUS_LED, HIGH);

  float weight = readWeightMedian5();
  float depth  = readDistanceCm();
  float delta  = weight - lastReportedWeight;

  Serial.printf("[SENSE] weight=%.2fg depth=%.1fcm delta=%.2fg\n",
                weight, depth, delta);

  if (fabs(delta) >= WEIGHT_DELTA_G) {
    if (postIngest(delta, depth)) {
      lastReportedWeight = weight;
      Serial.println("[POST] ingest OK");
    } else {
      Serial.println("[POST] ingest FAILED after retries");
    }
  } else {
    Serial.println("[SKIP] delta below threshold");
  }

  digitalWrite(STATUS_LED, LOW);
  goToDeepSleep(); // one measurement per boot cycle
}
