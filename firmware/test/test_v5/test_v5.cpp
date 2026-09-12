// Тести парсера V5 на реальних кадрах зі spike/dumps/2763543833_20260912T124433Z.json
// (стік 2763543833, інвертор SUN-15K-SG01HP3).
#include <unity.h>
#include <string.h>
#include <stdio.h>
#include "solarman_v5.h"

static const uint32_t SERIAL = 2763543833u;

static size_t unhex(const char* hex, uint8_t* out, size_t cap) {
    size_t n = strlen(hex) / 2;
    if (n > cap) return 0;
    for (size_t i = 0; i < n; i++) {
        unsigned v; sscanf(hex + 2 * i, "%2x", &v); out[i] = (uint8_t)v;
    }
    return n;
}

// frames[0]: read 0..59, seq 0x72
static const char* REQ_0_60 =
    "a51700104572001955b8a402000000000000000000000000000001030000003c45db0a15";
static const char* RSP_0_60 =
    "a58b001015720a1955b8a40201fee92b016d020000325f79690103780006000101043233303932303833313700"
    "00000000001e0800002b1e3002106100002001c027000049f0000202030000000100000000001b0001000a0001"
    "010000000000000000000001000000000000000000000000000000000000000000000000000000000000000000"
    "000000000000000000000000005ee23d15";

void test_modbus_crc_vector() {
    // 01 03 00 00 00 0A -> CRC 0xCDC5
    uint8_t f[] = {1, 3, 0, 0, 0, 10};
    TEST_ASSERT_EQUAL_HEX16(0xCDC5, v5::modbusCrc(f, 6));
}

void test_build_matches_real_request() {
    uint8_t expect[64], got[64];
    size_t n = unhex(REQ_0_60, expect, sizeof expect);
    size_t m = v5::buildReadHolding(got, sizeof got, SERIAL, 0x72, 1, 0, 60);
    TEST_ASSERT_EQUAL(n, m);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(expect, got, n);
}

void test_parse_real_response() {
    uint8_t f[300]; uint16_t regs[60];
    size_t n = unhex(RSP_0_60, f, sizeof f);
    TEST_ASSERT_EQUAL(152, n);
    TEST_ASSERT_EQUAL(n, v5::frameLength(f));
    v5::Result r = v5::parseResponse(f, n, 0x72, 60, regs);
    TEST_ASSERT_EQUAL((int)v5::Status::Ok, (int)r.status);
    TEST_ASSERT_EQUAL(60, r.count);
    TEST_ASSERT_EQUAL_HEX16(0x0006, regs[0]);   // 3-phase HV hybrid
    TEST_ASSERT_EQUAL_HEX16(0x3233, regs[3]);   // серійник "23..."
    TEST_ASSERT_EQUAL_HEX16(0x1e08, regs[11]);
    TEST_ASSERT_EQUAL_HEX16(0x49f0, regs[20]);  // rated power low word
}

void test_parse_rejects_wrong_seq() {
    uint8_t f[300]; uint16_t regs[60];
    size_t n = unhex(RSP_0_60, f, sizeof f);
    v5::Result r = v5::parseResponse(f, n, 0x73, 60, regs);
    TEST_ASSERT_EQUAL((int)v5::Status::SeqMismatch, (int)r.status);
}

void test_parse_rejects_bad_checksum() {
    uint8_t f[300]; uint16_t regs[60];
    size_t n = unhex(RSP_0_60, f, sizeof f);
    f[30] ^= 0x01;
    v5::Result r = v5::parseResponse(f, n, 0x72, 60, regs);
    TEST_ASSERT_EQUAL((int)v5::Status::BadChecksum, (int)r.status);
}

void test_parse_rejects_count_mismatch() {
    uint8_t f[300]; uint16_t regs[60];
    size_t n = unhex(RSP_0_60, f, sizeof f);
    v5::Result r = v5::parseResponse(f, n, 0x72, 59, regs);
    TEST_ASSERT_EQUAL((int)v5::Status::CountMismatch, (int)r.status);
}

void test_parse_modbus_exception() {
    // Синтетична відповідь: modbus 01 83 02 + crc, загорнута в V5
    uint8_t mb[5] = {1, 0x83, 2, 0, 0};
    uint16_t crc = v5::modbusCrc(mb, 3); mb[3] = crc & 0xFF; mb[4] = crc >> 8;
    uint8_t f[64]; size_t i = 0;
    f[i++] = 0xA5; uint16_t plen = 14 + 5; f[i++] = plen & 0xFF; f[i++] = plen >> 8;
    f[i++] = 0x10; f[i++] = 0x15; f[i++] = 0x42; f[i++] = 0x00;
    f[i++] = 0x19; f[i++] = 0x55; f[i++] = 0xb8; f[i++] = 0xa4;
    f[i++] = 0x02; f[i++] = 0x01; for (int k = 0; k < 12; k++) f[i++] = 0;
    memcpy(f + i, mb, 5); i += 5;
    uint8_t sum = 0; for (size_t k = 1; k < i; k++) sum += f[k];
    f[i++] = sum; f[i++] = 0x15;
    uint16_t regs[1];
    v5::Result r = v5::parseResponse(f, i, 0x42, 1, regs);
    TEST_ASSERT_EQUAL((int)v5::Status::ModbusException, (int)r.status);
    TEST_ASSERT_EQUAL(2, r.modbusException);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_modbus_crc_vector);
    RUN_TEST(test_build_matches_real_request);
    RUN_TEST(test_parse_real_response);
    RUN_TEST(test_parse_rejects_wrong_seq);
    RUN_TEST(test_parse_rejects_bad_checksum);
    RUN_TEST(test_parse_rejects_count_mismatch);
    RUN_TEST(test_parse_modbus_exception);
    return UNITY_END();
}
