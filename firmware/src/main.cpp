#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include <Firebase_ESP_Client.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <math.h>
#include "audio_data.h"
#include "firebase_config.h"

namespace {
constexpr uint8_t UHF_RX_PIN = 16;
constexpr uint8_t UHF_TX_PIN = 17;
constexpr uint8_t UHF_FRAME_MAX_SIZE = 64;
constexpr uint8_t TONE_PIN = 25;
constexpr uint8_t PWM_CHANNEL = 0;
constexpr uint8_t PWM_RESOLUTION = 8;
constexpr uint8_t LED_PIN_1 = 4;
constexpr uint16_t NUM_LEDS_1 = 6;
constexpr uint32_t FIRE_ALARM_CYCLE_MS = 2000;
constexpr uint8_t FIRE_ALARM_CYCLES = 2;
constexpr uint8_t AUDIO_CLIP_REPEATS = 1;
constexpr uint32_t REMOTE_MODE_HOLD_MS = 5000;
constexpr uint32_t TAG_ABSENCE_RESET_MS = 3000;
constexpr uint8_t MAX_TRACKED_TAGS = 64;
constexpr uint8_t READ_MULTI_COMMAND[] = {
    0xBB, 0x00, 0x27, 0x00, 0x03, 0x22, 0xFF, 0xFF, 0x4A, 0x7E};

enum class LightMode : uint8_t {
  Off,
  StartupPurple,
  Breathing,
  SolidGreen,
  SolidYellow,
  Alarm,
  FlashingGreen
};

struct TagPresence {
  char tagId[25];
  uint32_t lastSeenAt;
  bool used;
};

struct FirebaseCommand {
  char commandId[65];
  char connectionId[40];
  char value;
};

FirebaseData firebaseData;
FirebaseData firebaseCommandStream;
FirebaseData firebaseResponseData;
WiFiClientSecure scanClient;
FirebaseAuth firebaseAuth;
FirebaseConfig firebaseConfig;
Adafruit_NeoPixel strip1(NUM_LEDS_1, LED_PIN_1, NEO_GRB + NEO_KHZ800);
TagPresence trackedTags[MAX_TRACKED_TAGS] = {};
uint8_t uhfFrame[UHF_FRAME_MAX_SIZE] = {};
uint8_t uhfFrameLength = 0;
bool receivingUhfFrame = false;
hw_timer_t *audioTimer = nullptr;
volatile uint32_t audioIndex = 0;
volatile bool isPlaying = false;
volatile bool fireAlarmActive = false;
volatile uint32_t sirenSampleIndex = 0;
volatile uint32_t sirenPhase = 0;
volatile uint8_t audioClipsRemaining = 0;
LightMode lightMode = LightMode::Off;
bool alarmActive = false;
uint32_t lastLedUpdate = 0;
uint32_t lightModeStartedAt = 0;
QueueHandle_t commandQueue = nullptr;
QueueHandle_t acknowledgementQueue = nullptr;
bool firebaseConfigured = false;
uint32_t lastInvalidUhfFrameAt = 0;
volatile bool firebaseCommunicationReady = false;
char activeConnectionId[40] = {};
volatile bool uhfScanningStarted = false;

bool readHttpResponseBody(int contentLength, bool chunked) {
  uint8_t buffer[64];
  if (chunked) {
    for (;;) {
      String sizeLine = scanClient.readStringUntil('\n');
      sizeLine.trim();
      const int extension = sizeLine.indexOf(';');
      if (extension >= 0) {
        sizeLine.remove(extension);
      }
      const long chunkSize = strtol(sizeLine.c_str(), nullptr, 16);
      if (chunkSize < 0 || chunkSize > 4096) {
        return false;
      }
      if (chunkSize == 0) {
        while (scanClient.connected()) {
          String trailer = scanClient.readStringUntil('\n');
          if (trailer == "\r" || trailer.length() == 0) {
            break;
          }
        }
        return true;
      }

      long remaining = chunkSize;
      while (remaining > 0) {
        const size_t requested =
            static_cast<size_t>(min(remaining, static_cast<long>(sizeof(buffer))));
        const size_t received = scanClient.readBytes(buffer, requested);
        if (received != requested) {
          return false;
        }
        remaining -= static_cast<long>(received);
      }
      if (scanClient.read() != '\r' || scanClient.read() != '\n') {
        return false;
      }
    }
  }

  if (contentLength < 0) {
    return false;
  }
  int remaining = contentLength;
  while (remaining > 0) {
    const size_t requested =
        static_cast<size_t>(min(remaining, static_cast<int>(sizeof(buffer))));
    const size_t received = scanClient.readBytes(buffer, requested);
    if (received != requested) {
      return false;
    }
    remaining -= static_cast<int>(received);
  }
  return true;
}

bool postTagScan(const char *tagId, const char *connectionId) {
  constexpr char host[] = "lightlink-cbe74-default-rtdb.firebaseio.com";
  constexpr char path[] = "/scans.json";
  char body[160];
  const int bodyLength = snprintf(
      body, sizeof(body),
      "{\"tagId\":\"%s\",\"receivedAt\":{\".sv\":\"timestamp\"},"
      "\"connectionId\":\"%s\"}",
      tagId, connectionId);
  if (bodyLength < 0 || static_cast<size_t>(bodyLength) >= sizeof(body)) {
    Serial.println("ERROR: Tag scan JSON is too large.");
    return false;
  }

  scanClient.setInsecure();
  scanClient.setTimeout(5000);
  if (!scanClient.connected() && !scanClient.connect(host, 443)) {
    Serial.println("Tag scan POST failed: HTTPS connection failed.");
    scanClient.stop();
    return false;
  }

  scanClient.printf("POST %s HTTP/1.1\r\n", path);
  scanClient.printf("Host: %s\r\n", host);
  scanClient.println("Content-Type: application/json");
  scanClient.printf("Content-Length: %d\r\n", bodyLength);
  scanClient.println("Connection: keep-alive");
  scanClient.println();
  scanClient.write(reinterpret_cast<const uint8_t *>(body), bodyLength);

  const String statusLine = scanClient.readStringUntil('\n');
  const int statusCode =
      statusLine.startsWith("HTTP/") ? statusLine.substring(9, 12).toInt() : 0;
  int contentLength = -1;
  bool chunked = false;
  while (scanClient.connected()) {
    String header = scanClient.readStringUntil('\n');
    if (header == "\r" || header.length() == 0) {
      break;
    }
    header.trim();
    if (header.startsWith("Content-Length:") ||
        header.startsWith("content-length:")) {
      contentLength = header.substring(header.indexOf(':') + 1).toInt();
    } else if (header.startsWith("Transfer-Encoding:") ||
               header.startsWith("transfer-encoding:")) {
      chunked = header.indexOf("chunked") >= 0 ||
                header.indexOf("Chunked") >= 0;
    }
  }
  const bool bodyRead = readHttpResponseBody(contentLength, chunked);
  if (statusCode == 200 && bodyRead) {
    Serial.printf("SCAN POST SUCCESSFUL: %s\n", tagId);
    return true;
  }

  Serial.printf("Scan POST failed (%d): %s\n", statusCode,
                statusLine.c_str());
  scanClient.stop();
  return false;
}

void generateConnectionId() {
  const String macAddress = WiFi.macAddress();
  snprintf(activeConnectionId, sizeof(activeConnectionId), "%s-%08lX",
           macAddress.c_str(), static_cast<unsigned long>(esp_random()));
}

void firebaseTask(void *parameter) {
  Firebase.reconnectWiFi(true);
  firebaseConfig.timeout.socketConnection = 5000;
  firebaseConfig.timeout.serverResponse = 5000;
  firebaseData.setResponseSize(128);
  firebaseCommandStream.setResponseSize(128);
  firebaseResponseData.setResponseSize(128);
  Firebase.begin(&firebaseConfig, &firebaseAuth);

  enum class HandshakePhase : uint8_t {
    WriteWaiting,
    WriteConnectionId,
    WriteCommunication,
    WaitForResponse,
    StartSignalStream,
    Ready
  };

  bool wasConnected = false;
  bool commandStreamStarted = false;
  bool signalInitialSnapshotPending = false;
  HandshakePhase phase = HandshakePhase::WriteWaiting;
  uint32_t lastResponsePollAt = 0;
  String lastProcessedCommandId;
  String lastResponseReadError;
  FirebaseCommand pendingAcknowledgement = {};
  bool acknowledgementPending = false;
  uint32_t lastAcknowledgementAttemptAt = 0;
  String lastStatusWriteError;
  String lastStatusWritePath;
  String lastAcknowledgementError;

  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if (wasConnected) {
        firebaseCommunicationReady = false;
        wasConnected = false;
        commandStreamStarted = false;
        phase = HandshakePhase::WriteWaiting;
        activeConnectionId[0] = '\0';
        lastProcessedCommandId = "";
        acknowledgementPending = false;
        xQueueReset(commandQueue);
        xQueueReset(acknowledgementQueue);
        uhfScanningStarted = false;
        Serial.println("Wi-Fi disconnected.");
      }
      firebaseCommunicationReady = false;
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    if (!wasConnected) {
      wasConnected = true;
      generateConnectionId();
      Serial.printf("Connection ID: %s\n", activeConnectionId);
      phase = HandshakePhase::WriteWaiting;
      commandStreamStarted = false;
      lastProcessedCommandId = "";
      lastResponseReadError = "";
      lastStatusWriteError = "";
      lastStatusWritePath = "";
      acknowledgementPending = false;
      xQueueReset(commandQueue);
      xQueueReset(acknowledgementQueue);
    }

    if (!Firebase.ready()) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    if (phase == HandshakePhase::WriteWaiting) {
      if (Firebase.RTDB.setString(&firebaseData, "/status/response",
                                  "waiting")) {
        lastStatusWriteError = "";
        lastStatusWritePath = "";
        phase = HandshakePhase::WriteConnectionId;
      } else {
        const String error = firebaseData.errorReason();
        if (error != lastStatusWriteError ||
            lastStatusWritePath != "/status/response") {
          Serial.printf("Firebase write /status/response failed: %s\n",
                        error.c_str());
          lastStatusWriteError = error;
          lastStatusWritePath = "/status/response";
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
      }
    } else if (phase == HandshakePhase::WriteConnectionId) {
      if (Firebase.RTDB.setString(&firebaseData, "/status/connectionId",
                                  activeConnectionId)) {
        lastStatusWriteError = "";
        lastStatusWritePath = "";
        phase = HandshakePhase::WriteCommunication;
      } else {
        const String error = firebaseData.errorReason();
        if (error != lastStatusWriteError ||
            lastStatusWritePath != "/status/connectionId") {
          Serial.printf("Firebase write /status/connectionId failed: %s\n",
                        error.c_str());
          lastStatusWriteError = error;
          lastStatusWritePath = "/status/connectionId";
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
      }
    } else if (phase == HandshakePhase::WriteCommunication) {
      if (Firebase.RTDB.setString(&firebaseData, "/status/communication",
                                  "success")) {
        lastStatusWriteError = "";
        lastStatusWritePath = "";
        phase = HandshakePhase::WaitForResponse;
        Serial.println("Waiting for app handshake.");
      } else {
        const String error = firebaseData.errorReason();
        if (error != lastStatusWriteError ||
            lastStatusWritePath != "/status/communication") {
          Serial.printf("Firebase write /status/communication failed: %s\n",
                        error.c_str());
          lastStatusWriteError = error;
          lastStatusWritePath = "/status/communication";
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
      }
    } else if (phase == HandshakePhase::WaitForResponse &&
               millis() - lastResponsePollAt >= 500UL) {
      lastResponsePollAt = millis();
      const bool responseRead =
          Firebase.RTDB.getString(&firebaseResponseData, "/status/response");
      if (responseRead && firebaseResponseData.dataType() == "string" &&
          firebaseResponseData.stringData() == "successful") {
        phase = HandshakePhase::StartSignalStream;
        lastResponseReadError = "";
      } else if (!responseRead) {
        const String error = firebaseResponseData.errorReason();
        if (error != lastResponseReadError) {
          Serial.printf("Firebase response read failed: %s\n",
                        error.c_str());
          lastResponseReadError = error;
        }
      } else {
        lastResponseReadError = "";
      }
    } else if (phase == HandshakePhase::StartSignalStream) {
      if (Firebase.RTDB.beginStream(&firebaseCommandStream, "/signal")) {
        firebaseCommandStream.keepAlive(5, 5, 1);
        commandStreamStarted = true;
        signalInitialSnapshotPending = true;
        phase = HandshakePhase::Ready;
        firebaseCommunicationReady = true;
        Serial.println("Firebase handshake complete; listening for commands.");
      } else {
        Serial.printf("Firebase signal stream failed: %s\n",
                      firebaseCommandStream.errorReason().c_str());
        vTaskDelay(pdMS_TO_TICKS(2000));
      }
    } else if (phase == HandshakePhase::Ready) {
      if (commandStreamStarted &&
          Firebase.RTDB.readStream(&firebaseCommandStream) &&
          firebaseCommandStream.streamAvailable()) {
        if (signalInitialSnapshotPending) {
          signalInitialSnapshotPending = false;
        } else if (firebaseCommandStream.dataType() == "json") {
          FirebaseJson &signal = firebaseCommandStream.jsonObject();
          FirebaseJsonData commandIdData;
          FirebaseJsonData commandValueData;
          signal.get(commandIdData, "commandId");
          signal.get(commandValueData, "value");
          if (commandIdData.success && commandIdData.type == "string" &&
              commandValueData.success && commandValueData.type == "string" &&
              commandIdData.stringValue.length() > 0 &&
              commandIdData.stringValue.length() <
                  sizeof(FirebaseCommand::commandId) &&
              commandValueData.stringValue.length() == 1 &&
              (commandValueData.stringValue[0] == 'a' ||
               commandValueData.stringValue[0] == 'b' ||
               commandValueData.stringValue[0] == 'c' ||
               commandValueData.stringValue[0] == 'd') &&
              commandIdData.stringValue != lastProcessedCommandId) {
            FirebaseCommand command = {};
            commandIdData.stringValue.toCharArray(command.commandId,
                                                   sizeof(command.commandId));
            command.value = commandValueData.stringValue[0];
            strlcpy(command.connectionId, activeConnectionId,
                    sizeof(command.connectionId));
            if (xQueueSend(commandQueue, &command, 0) == pdPASS) {
              lastProcessedCommandId = commandIdData.stringValue;
            } else {
              Serial.println("ERROR: Command queue full.");
            }
          }
        }
      } else if (firebaseCommandStream.streamTimeout() &&
                 !firebaseCommandStream.httpConnected()) {
        Serial.println("Firebase signal stream disconnected.");
        commandStreamStarted = false;
        signalInitialSnapshotPending = false;
        phase = HandshakePhase::StartSignalStream;
        firebaseCommunicationReady = false;
        uhfScanningStarted = false;
      }

      if (!acknowledgementPending &&
          xQueueReceive(acknowledgementQueue, &pendingAcknowledgement, 0) ==
              pdPASS) {
        acknowledgementPending = true;
      }
      if (acknowledgementPending &&
          millis() - lastAcknowledgementAttemptAt >= 500UL) {
        lastAcknowledgementAttemptAt = millis();
        FirebaseJson acknowledgement;
        FirebaseJson appliedAt;
        acknowledgement.set("commandId", pendingAcknowledgement.commandId);
        char value[2] = {pendingAcknowledgement.value, '\0'};
        acknowledgement.set("value", value);
        appliedAt.set(".sv", "timestamp");
        acknowledgement.set("appliedAt", appliedAt);
        acknowledgement.set("connectionId",
                            pendingAcknowledgement.connectionId);
        if (Firebase.RTDB.setJSON(&firebaseData, "/acknowledgement",
                                  &acknowledgement)) {
          acknowledgementPending = false;
          lastAcknowledgementError = "";
          Serial.println("Command acknowledged.");
        } else {
          const String error = firebaseData.errorReason();
          if (error != lastAcknowledgementError) {
            Serial.printf("Command acknowledgement failed: %s\n",
                          error.c_str());
            lastAcknowledgementError = error;
          }
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void IRAM_ATTR onAudioTimer() {
  if (fireAlarmActive) {
    const uint32_t samplesPerCycle =
        AUDIO_SAMPLE_RATE * FIRE_ALARM_CYCLE_MS / 1000UL;
    const uint32_t sampleInCycle = sirenSampleIndex % samplesPerCycle;
    const uint32_t sampleInSweep = sampleInCycle % AUDIO_SAMPLE_RATE;
    const uint32_t frequency =
        sampleInCycle < AUDIO_SAMPLE_RATE
            ? 700UL + sampleInSweep * 500UL / AUDIO_SAMPLE_RATE
            : 1200UL - sampleInSweep * 500UL / AUDIO_SAMPLE_RATE;
    sirenPhase += frequency * 268435UL;
    int16_t output = ((sirenPhase & 0x80000000UL) ? 120 : 136) - 128;
    output = output * 15 + 128;
    if (output > 255) output = 255;
    if (output < 0) output = 0;
    ledcWrite(PWM_CHANNEL, static_cast<uint8_t>(output));

    ++sirenSampleIndex;
    if (sirenSampleIndex >= samplesPerCycle * FIRE_ALARM_CYCLES) {
      fireAlarmActive = false;
      sirenSampleIndex = 0;
      sirenPhase = 0;
      audioIndex = 0;
      isPlaying = true;
    }
  } else if (isPlaying) {
    int16_t sample = audio_data[audioIndex] - 128;
    sample = sample * 15 + 128;
    if (sample > 255) sample = 255;
    if (sample < 0) sample = 0;
    ledcWrite(PWM_CHANNEL, static_cast<uint8_t>(sample));
    ++audioIndex;

    if (audioIndex >= AUDIO_DATA_LEN) {
      --audioClipsRemaining;
      if (audioClipsRemaining > 0) {
        audioIndex = 0;
        sirenSampleIndex = 0;
        sirenPhase = 0;
        fireAlarmActive = true;
        isPlaying = false;
      } else {
        audioIndex = 0;
        isPlaying = false;
        ledcWrite(PWM_CHANNEL, 0);
      }
    }
  }
}

String readUhfEpc(const uint8_t *frame, uint8_t epcLength) {
  String epc;
  for (uint8_t i = 0; i < epcLength; ++i) {
    const uint8_t byte = frame[8 + i];
    if (byte < 0x10) {
      epc += '0';
    }
    epc += String(byte, HEX);
  }
  epc.toUpperCase();
  return epc;
}

void setStripColor(Adafruit_NeoPixel &strip, uint32_t color) {
  for (uint16_t i = 0; i < strip.numPixels(); ++i) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

void updateBreathingStrip(Adafruit_NeoPixel &strip, uint32_t time) {
  const float phase = (time % 3000UL) / 3000.0f;
  const float breathe = (1.0f - cosf(phase * 2.0f * PI)) / 2.0f;
  const uint8_t level = strip.gamma8(
      static_cast<uint8_t>((0.12f + 0.88f * breathe) * 255.0f));
  setStripColor(strip, strip.Color(0, level, level));
}

void stopAlarm() {
  noInterrupts();
  fireAlarmActive = false;
  isPlaying = false;
  audioIndex = 0;
  audioClipsRemaining = 0;
  interrupts();
  ledcWrite(PWM_CHANNEL, 0);
  alarmActive = false;
}

bool startAlarm() {
  if (audioTimer == nullptr) {
    Serial.println("ERROR: Audio timer unavailable; cannot play the alarm.");
    return false;
  }

  noInterrupts();
  audioIndex = 0;
  audioClipsRemaining = AUDIO_CLIP_REPEATS;
  sirenSampleIndex = 0;
  sirenPhase = 0;
  isPlaying = false;
  fireAlarmActive = true;
  interrupts();

  alarmActive = true;
  lightMode = LightMode::Alarm;
  Serial.println("Command c applied.");
  return true;
}

bool applyFirebaseCommand(char command) {
  const uint32_t now = millis();
  if (command != 'c') {
    stopAlarm();
    lightModeStartedAt = now;
  }

  switch (command) {
    case 'a':
      lightMode = LightMode::SolidGreen;
      Serial.println("Command a applied.");
      return true;
    case 'b':
      lightMode = LightMode::SolidYellow;
      Serial.println("Command b applied.");
      return true;
    case 'c':
      return startAlarm();
    case 'd':
      lightMode = LightMode::FlashingGreen;
      Serial.println("Command d applied.");
      return true;
    default:
      return false;
  }
}

void processEpc(const String &epc) {
  const uint32_t now = millis();
  TagPresence *entry = nullptr;
  TagPresence *oldestInactive = nullptr;

  for (TagPresence &tracked : trackedTags) {
    if (tracked.used && strcmp(tracked.tagId, epc.c_str()) == 0) {
      entry = &tracked;
      break;
    }
    if (!tracked.used) {
      if (entry == nullptr) {
        entry = &tracked;
      }
    } else if (now - tracked.lastSeenAt >= TAG_ABSENCE_RESET_MS &&
               (oldestInactive == nullptr ||
                now - tracked.lastSeenAt >
                    now - oldestInactive->lastSeenAt)) {
      oldestInactive = &tracked;
    }
  }

  bool upload = true;
  if (entry != nullptr && entry->used) {
    upload = now - entry->lastSeenAt >= TAG_ABSENCE_RESET_MS;
  } else if (entry == nullptr) {
    entry = oldestInactive;
  }

  if (entry == nullptr) {
    Serial.println("ERROR: Tag presence table is full; scan not uploaded.");
    return;
  }

  if (!entry->used || strcmp(entry->tagId, epc.c_str()) != 0) {
    epc.toCharArray(entry->tagId, sizeof(entry->tagId));
    entry->used = true;
    upload = true;
  }
  entry->lastSeenAt = now;

  if (!upload) {
    return;
  }

  if (!firebaseCommunicationReady || WiFi.status() != WL_CONNECTED) {
    return;
  }
  postTagScan(entry->tagId, activeConnectionId);
}

void handleUhfFrame(const uint8_t *frame, uint8_t length) {
  if (length < 7 || frame[0] != 0xBB || frame[length - 1] != 0x7E) {
    return;
  }
  if (frame[1] != 0x02 || frame[2] != 0x22 || frame[3] != 0x00) {
    return;
  }
  if (length < 12 || length != static_cast<uint8_t>(frame[4] + 7) ||
      frame[4] < 5) {
    const uint32_t now = millis();
    if (now - lastInvalidUhfFrameAt >= 2000) {
      Serial.printf("UHF frame ignored (length %u):", length);
      for (uint8_t i = 0; i < length; ++i) {
        Serial.printf(" %02X", frame[i]);
      }
      Serial.println();
      lastInvalidUhfFrameAt = now;
    }
    return;
  }

  const uint8_t epcLength = frame[4] - 5;
  const uint16_t pc = (static_cast<uint16_t>(frame[6]) << 8) | frame[7];
  const uint8_t pcEpcLength = ((pc >> 11) & 0x1F) * 2;
  if (epcLength == 0 || epcLength > 24 || pcEpcLength != epcLength) {
    const uint32_t now = millis();
    if (now - lastInvalidUhfFrameAt >= 2000) {
      Serial.printf(
          "UHF tag frame ignored: invalid EPC length (payload=%u, PC=%u).\n",
          epcLength, pcEpcLength);
      lastInvalidUhfFrameAt = now;
    }
    return;
  }
  processEpc(readUhfEpc(frame, epcLength));
}

void readUhfData() {
  while (Serial2.available() > 0) {
    const uint8_t incoming = static_cast<uint8_t>(Serial2.read());
    if (!receivingUhfFrame) {
      if (incoming == 0xBB) {
        receivingUhfFrame = true;
        uhfFrameLength = 0;
      } else {
        continue;
      }
    } else if (incoming == 0xBB && uhfFrameLength > 0) {
      uhfFrameLength = 0;
    }

    if (uhfFrameLength >= UHF_FRAME_MAX_SIZE) {
      receivingUhfFrame = false;
      uhfFrameLength = 0;
      continue;
    }
    uhfFrame[uhfFrameLength++] = incoming;

    if (incoming == 0x7E) {
      handleUhfFrame(uhfFrame, uhfFrameLength);
      receivingUhfFrame = false;
      uhfFrameLength = 0;
    }
  }
}

void updateLights(uint32_t now) {
  if (now - lastLedUpdate < 20) {
    return;
  }
  lastLedUpdate = now;

  if (lightMode == LightMode::Off) {
    setStripColor(strip1, strip1.Color(0, 0, 0));
  } else if (lightMode == LightMode::StartupPurple) {
    const bool flashOn = (now / 350UL) % 2 == 0;
    const uint32_t color =
        flashOn ? strip1.Color(128, 0, 128) : strip1.Color(0, 0, 0);
    setStripColor(strip1, color);
  } else if (lightMode == LightMode::SolidGreen) {
    setStripColor(strip1, strip1.Color(0, 255, 0));
  } else if (lightMode == LightMode::SolidYellow) {
    setStripColor(strip1, strip1.Color(255, 165, 0));
  } else if (lightMode == LightMode::Alarm) {
    const uint32_t flashTime = now % 1200UL;
    const bool flashOn = flashTime < 180UL ||
                         (flashTime >= 320UL && flashTime < 500UL);
    const uint32_t color =
        flashOn ? strip1.Color(255, 0, 0) : strip1.Color(0, 0, 0);
    setStripColor(strip1, color);
  } else if (lightMode == LightMode::FlashingGreen) {
    const bool flashOn = (now / 300UL) % 2 == 0;
    const uint32_t color =
        flashOn ? strip1.Color(0, 255, 0) : strip1.Color(0, 0, 0);
    setStripColor(strip1, color);
  } else {
    updateBreathingStrip(strip1, now);
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nYRM1003 UHF RFID light and alarm controller");

  strip1.begin();
  setStripColor(strip1, strip1.Color(0, 0, 0));

  firebaseConfigured = strlen(FIREBASE_DATABASE_HOST) > 0;
  if (firebaseConfigured) {
    firebaseConfig.database_url = FIREBASE_DATABASE_HOST;
    firebaseConfig.signer.test_mode = true;
    commandQueue = xQueueCreate(4, sizeof(FirebaseCommand));
    acknowledgementQueue = xQueueCreate(4, sizeof(FirebaseCommand));
    if (commandQueue == nullptr || acknowledgementQueue == nullptr) {
      Serial.println("ERROR: Could not create Firebase queues.");
      firebaseConfigured = false;
    }
  }

  if (strlen(WIFI_SSID) > 0) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    Serial.println("Connecting to Wi-Fi...");
    if (strlen(WIFI_PASSWORD) == 0) {
      WiFi.begin(WIFI_SSID);
    } else {
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }

    const uint32_t wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED &&
           millis() - wifiStart < 15000UL) {
      delay(250);
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("Wi-Fi connected. ESP32 IP address: %s\n",
                    WiFi.localIP().toString().c_str());
    } else {
      Serial.println(
          "Wi-Fi not connected. Register the MAC address if required, then "
          "restart the ESP32.");
    }
  } else {
    Serial.println(
        "Wi-Fi SSID is empty. Copy include/secrets.example.h to "
        "include/secrets.h and set WIFI_SSID / WIFI_PASSWORD.");
  }

  lightMode = LightMode::StartupPurple;

  if (!firebaseConfigured) {
    Serial.println(
        "Firebase not configured. Set FIREBASE_DATABASE_HOST in "
        "include/firebase_config.h.");
  } else if (xTaskCreatePinnedToCore(firebaseTask, "firebaseTask", 8192,
                                     nullptr, 1, nullptr, 0) != pdPASS) {
    Serial.println("ERROR: Could not start Firebase background task.");
    firebaseConfigured = false;
  }

  ledcSetup(PWM_CHANNEL, 312500, PWM_RESOLUTION);
  ledcAttachPin(TONE_PIN, PWM_CHANNEL);
  ledcWrite(PWM_CHANNEL, 0);
  audioTimer = timerBegin(0, 8, true);
  if (audioTimer != nullptr) {
    timerAttachInterrupt(audioTimer, &onAudioTimer, true);
    timerAlarmWrite(audioTimer, 625, true);
    timerAlarmEnable(audioTimer);
  } else {
    Serial.println("ERROR: Could not initialize the audio timer.");
  }

  Serial2.begin(115200, SERIAL_8N1, UHF_RX_PIN, UHF_TX_PIN);
  Serial.println("YRM1003 ready.");
}

void loop() {
  const uint32_t now = millis();

  if (lightMode == LightMode::StartupPurple &&
      firebaseCommunicationReady) {
    lightMode = LightMode::Breathing;
  }

  if (firebaseCommunicationReady && !uhfScanningStarted) {
    Serial2.write(READ_MULTI_COMMAND, sizeof(READ_MULTI_COMMAND));
    uhfScanningStarted = true;
  }
  if (firebaseCommunicationReady) {
    readUhfData();
  } else {
    while (Serial2.available() > 0) {
      Serial2.read();
    }
    uhfScanningStarted = false;
  }

  FirebaseCommand command = {};
  if (firebaseCommunicationReady && commandQueue != nullptr &&
      xQueueReceive(commandQueue, &command, 0) == pdPASS &&
      strcmp(command.connectionId, activeConnectionId) == 0) {
    if (applyFirebaseCommand(command.value) && acknowledgementQueue != nullptr &&
        xQueueSend(acknowledgementQueue, &command, 0) != pdPASS) {
      Serial.println("ERROR: Acknowledgement queue full.");
    }
  }

  if (alarmActive && !fireAlarmActive && !isPlaying) {
    alarmActive = false;
    lightMode = LightMode::Breathing;
    Serial.println("Alarm finished.");
  }

  if ((lightMode == LightMode::SolidGreen ||
       lightMode == LightMode::SolidYellow ||
       lightMode == LightMode::FlashingGreen) &&
      now - lightModeStartedAt >= REMOTE_MODE_HOLD_MS) {
    lightMode = LightMode::Breathing;
    Serial.println("Command timeout.");
  }

  updateLights(now);
  delay(5);
}
