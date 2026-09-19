package com.gymos.common.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class MaskingUtilsTest {

    @Test
    void masksEmailLikeTheNodeBackend() {
        assertEquals("ra***@gmail.com", MaskingUtils.maskEmail("rahul@gmail.com"));
        assertEquals("ab******@test.local", MaskingUtils.maskEmail("abcdefgh@test.local"));
        assertEquals("ad***@gym.local", MaskingUtils.maskEmail("admin@gym.local"));
    }

    @Test
    void masksEmailWithSingleCharLocalPart() {
        assertEquals("a**@x.io", MaskingUtils.maskEmail("a@x.io"));
    }

    @Test
    void leavesEmailWithoutAtSignUnchanged() {
        assertEquals("no-at-sign", MaskingUtils.maskEmail("no-at-sign"));
    }

    @Test
    void masksPhoneKeepingFirstTwoAndLastTwoDigits() {
        assertEquals("91****12", MaskingUtils.maskPhone("+91 98765 43212"));
        assertEquals("99****01", MaskingUtils.maskPhone("9990000001"));
    }

    @Test
    void masksShortPhoneFully() {
        assertEquals("****", MaskingUtils.maskPhone("1234"));
        assertEquals("****", MaskingUtils.maskPhone("123"));
    }
}
