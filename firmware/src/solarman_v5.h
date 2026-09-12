// Solarman V5 (LSW-3 / LSE-3 WiFi stick) + Modbus RTU read-holding.
// Чистий C++ без Arduino-залежностей, щоб тестувати на хості (pio test -e native).
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace v5 {

static const uint8_t  START = 0xA5;
static const uint8_t  END   = 0x15;
static const uint16_t CTRL_REQUEST  = 0x4510;
static const uint16_t CTRL_RESPONSE = 0x1510;
static const size_t   HEADER_LEN = 11;   // start(1) len(2) ctrl(2) seq(2) serial(4)
static const size_t   REQ_PAYLOAD_HDR = 15;  // type(1) sensor(2) 3x time(4)
static const size_t   RSP_PAYLOAD_HDR = 14;  // type(1) status(1) 3x time(4)
static const size_t   MAX_FRAME = 11 + 14 + 3 + 2 * 125 + 2 + 2;  // 282

uint16_t modbusCrc(const uint8_t* data, size_t len);

// Повний V5-кадр із запитом Modbus 0x03. Повертає довжину або 0, якщо не влазить.
size_t buildReadHolding(uint8_t* out, size_t cap, uint32_t loggerSerial,
                        uint8_t seq, uint8_t slave, uint16_t start, uint16_t count);

// Довжина всього кадру за заголовком (перші 3 байти) або 0, якщо заголовок битий.
size_t frameLength(const uint8_t* header);

// Серійник логера з заголовка кадру (байти 7..10, LE). Стік відповідає на запит
// з будь-яким серійником, підставляючи свій — так його можна дізнатись без discovery.
uint32_t headerSerial(const uint8_t* header);
bool     isResponse(const uint8_t* header);

enum class Status : uint8_t {
    Ok, BadFrame, BadChecksum, NotResponse, SeqMismatch,
    ModbusCrc, ModbusException, CountMismatch,
};

struct Result {
    Status  status;
    uint8_t modbusException;  // код, якщо status == ModbusException
    uint16_t count;           // скільки регістрів записано в regs
    uint16_t control;         // control code кадру (для діагностики)
};

// Розбирає V5-відповідь, кладе регістри в regs (місткість >= expectedCount).
Result parseResponse(const uint8_t* frame, size_t len, uint8_t expectedSeq,
                     uint16_t expectedCount, uint16_t* regs);

}  // namespace v5
