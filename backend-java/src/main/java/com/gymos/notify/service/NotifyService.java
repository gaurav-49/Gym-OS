package com.gymos.notify.service;

/**
 * Message delivery — email (SMTP), SMS and WhatsApp (Twilio) with a console
 * fallback in dev mode. Implemented by NotifyServiceImpl.
 */
public interface NotifyService {

    /** @return "console" or "email" — same contract as the Node OTP sendEmail. */
    String sendEmail(String to, String otp);

    /** @return "console" or "sms" — same contract as the Node OTP sendSms. */
    String sendSms(String to, String otp);

    /** Result of a notification delivery — mirrors the Node { delivered, recipient }. */
    record Delivery(String delivered, String recipient) {
    }

    /** Notification email (reminders / receipts) — never throws; failure returns "failed". */
    Delivery sendNotificationEmail(String to, String subject, String text);

    /** WhatsApp via Twilio (reminders / dunning) — never throws; failure returns "failed". */
    Delivery sendWhatsApp(String to, String message);
}
