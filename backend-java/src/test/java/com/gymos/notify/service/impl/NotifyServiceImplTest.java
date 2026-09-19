package com.gymos.notify.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class NotifyServiceImplTest {

    /** No SMTP/Twilio configured (dev mode): OTP goes to the console. */
    private final NotifyServiceImpl dev = new NotifyServiceImpl(
        "", 587, false, "", "", "", "", "", "", 10);

    @Test
    void noSmtpConfiguredFallsBackToConsoleForEmail() {
        assertEquals("console", dev.sendEmail("admin@gym.local", "123456"));
    }

    @Test
    void noTwilioConfiguredFallsBackToConsoleForSms() {
        assertEquals("console", dev.sendSms("9990000001", "123456"));
    }

    @Test
    void smtpConfiguredButUnreachableThrowsSoAuthLayerReturns500() {
        NotifyServiceImpl smtp = new NotifyServiceImpl(
            "localhost", 1, false, "smtpuser", "smtppass", "test@gym.local", "", "", "", 10);
        assertThrows(IllegalStateException.class, () -> smtp.sendEmail("admin@gym.local", "123456"));
    }
}
