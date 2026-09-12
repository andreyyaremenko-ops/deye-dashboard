#include "solarman_v5.h"
#include <string.h>

namespace v5 {

uint16_t modbusCrc(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++)
            crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
    return crc;
}

static void putLE16(uint8_t* p, uint16_t v) { p[0] = v & 0xFF; p[1] = v >> 8; }
static void putLE32(uint8_t* p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (v >> (8 * i)) & 0xFF; }
static uint16_t getLE16(const uint8_t* p) { return p[0] | (p[1] << 8); }

size_t buildReadHolding(uint8_t* out, size_t cap, uint32_t loggerSerial,
                        uint8_t seq, uint8_t slave, uint16_t start, uint16_t count) {
    const size_t modbusLen = 8;
    const size_t payloadLen = REQ_PAYLOAD_HDR + modbusLen;
    const size_t total = HEADER_LEN + payloadLen + 2;
    if (cap < total) return 0;

    uint8_t* p = out;
    *p++ = START;
    putLE16(p, (uint16_t)payloadLen); p += 2;
    putLE16(p, CTRL_REQUEST); p += 2;
    *p++ = seq; *p++ = 0x00;  // seq: один байт, другий стік заповнює сам
    putLE32(p, loggerSerial); p += 4;

    *p++ = 0x02;              // frame type
    putLE16(p, 0x0000); p += 2;  // sensor type
    putLE32(p, 0); p += 4;    // total working time
    putLE32(p, 0); p += 4;    // power on time
    putLE32(p, 0); p += 4;    // offset time

    uint8_t* mb = p;
    *p++ = slave; *p++ = 0x03;
    *p++ = start >> 8; *p++ = start & 0xFF;
    *p++ = count >> 8; *p++ = count & 0xFF;
    uint16_t crc = modbusCrc(mb, 6);
    *p++ = crc & 0xFF; *p++ = crc >> 8;

    uint8_t sum = 0;
    for (size_t i = 1; i < (size_t)(p - out); i++) sum += out[i];
    *p++ = sum;
    *p++ = END;
    return (size_t)(p - out);
}

uint32_t headerSerial(const uint8_t* h) {
    return (uint32_t)h[7] | ((uint32_t)h[8] << 8) | ((uint32_t)h[9] << 16) | ((uint32_t)h[10] << 24);
}

bool isResponse(const uint8_t* h) { return h[0] == START && getLE16(h + 3) == CTRL_RESPONSE; }

size_t frameLength(const uint8_t* h) {
    if (h[0] != START) return 0;
    return HEADER_LEN + getLE16(h + 1) + 2;
}

Result parseResponse(const uint8_t* f, size_t len, uint8_t expectedSeq,
                     uint16_t expectedCount, uint16_t* regs) {
    Result r{Status::BadFrame, 0, 0, 0};
    if (len < HEADER_LEN + RSP_PAYLOAD_HDR + 5 + 2) return r;
    if (f[0] != START || f[len - 1] != END) return r;
    if (frameLength(f) != len) return r;

    uint8_t sum = 0;
    for (size_t i = 1; i < len - 2; i++) sum += f[i];
    if (sum != f[len - 2]) { r.status = Status::BadChecksum; return r; }

    r.control = getLE16(f + 3);
    if (r.control != CTRL_RESPONSE) { r.status = Status::NotResponse; return r; }
    if (f[5] != expectedSeq) { r.status = Status::SeqMismatch; return r; }

    const uint8_t* mb = f + HEADER_LEN + RSP_PAYLOAD_HDR;
    size_t mbLen = len - 2 - (HEADER_LEN + RSP_PAYLOAD_HDR);
    if (mbLen < 5) return r;
    uint16_t crc = mb[mbLen - 2] | (mb[mbLen - 1] << 8);
    if (modbusCrc(mb, mbLen - 2) != crc) { r.status = Status::ModbusCrc; return r; }

    if (mb[1] & 0x80) { r.status = Status::ModbusException; r.modbusException = mb[2]; return r; }
    if (mb[1] != 0x03) return r;

    uint8_t byteCount = mb[2];
    if (byteCount != expectedCount * 2 || mbLen != (size_t)(3 + byteCount + 2)) {
        r.status = Status::CountMismatch; return r;
    }
    for (uint16_t i = 0; i < expectedCount; i++)
        regs[i] = (mb[3 + 2 * i] << 8) | mb[4 + 2 * i];
    r.count = expectedCount;
    r.status = Status::Ok;
    return r;
}

}  // namespace v5
