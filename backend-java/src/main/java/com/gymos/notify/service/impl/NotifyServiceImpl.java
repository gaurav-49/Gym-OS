package com.gymos.notify.service.impl;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import com.gymos.notify.service.NotifyService;

import jakarta.mail.internet.MimeMessage;

/**
 * Delivery implementation — mirrors the Node otpService gateways:
 *  - SMTP when SMTP_HOST is configured (JavaMailSender)
 *  - Twilio when SMS_TWILIO_SID is configured (REST call)
 *  - otherwise the OTP is printed to the server console (dev mode) and the
 *    caller returns it as dev_otp so the flow can be tested locally.
 */
@Service
public class NotifyServiceImpl implements NotifyService {

    private static final Logger log = LoggerFactory.getLogger("notifyService");

    private final String smtpHost;
    private final String smtpUser;
    private final String smtpPass;
    private final String mailFrom;
    private final int smtpPort;
    private final boolean smtpSecure;
    private final String twilioSid;
    private final String twilioToken;
    private final String twilioFrom;
    private final int otpTtlMinutes;

    public NotifyServiceImpl(@Value("${app.smtp.host:}") String smtpHost,
                             @Value("${app.smtp.port:587}") int smtpPort,
                             @Value("${app.smtp.secure:false}") boolean smtpSecure,
                             @Value("${app.smtp.user:}") String smtpUser,
                             @Value("${app.smtp.pass:}") String smtpPass,
                             @Value("${app.smtp.from:}") String mailFrom,
                             @Value("${app.twilio.sid:}") String twilioSid,
                             @Value("${app.twilio.token:}") String twilioToken,
                             @Value("${app.twilio.from:}") String twilioFrom,
                             @Value("${app.otp.ttl-minutes:10}") int otpTtlMinutes) {
        this.smtpHost = smtpHost;
        this.smtpPort = smtpPort;
        this.smtpSecure = smtpSecure;
        this.smtpUser = smtpUser;
        this.smtpPass = smtpPass;
        this.mailFrom = mailFrom;
        this.twilioSid = twilioSid;
        this.twilioToken = twilioToken;
        this.twilioFrom = twilioFrom;
        this.otpTtlMinutes = otpTtlMinutes;
    }

    @Override
    public String sendEmail(String to, String otp) {
        if (smtpHost == null || smtpHost.isBlank()) {
            log.info("sendEmail :: [DEV OTP] {}: {}", to, otp);
            return "console";
        }
        try {
            JavaMailSenderImpl sender = new JavaMailSenderImpl();
            sender.setHost(smtpHost);
            sender.setPort(smtpPort);
            if (smtpUser != null && !smtpUser.isBlank()) {
                sender.setUsername(smtpUser);
                sender.setPassword(smtpPass);
            }
            var props = sender.getJavaMailProperties();
            props.put("mail.smtp.auth", smtpUser != null && !smtpUser.isBlank());
            props.put("mail.smtp.starttls.enable", !smtpSecure);
            props.put("mail.smtp.ssl.enable", smtpSecure);

            MimeMessage msg = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg);
            helper.setFrom(mailFrom != null && !mailFrom.isBlank() ? mailFrom : smtpUser);
            helper.setTo(to);
            helper.setSubject("GYM OS — Password Reset OTP");
            helper.setText("Your password reset OTP is " + otp + ". It is valid for "
                + otpTtlMinutes + " minutes.");
            sender.send(msg);
            return "email";
        } catch (Exception e) {
            log.error("sendEmail :: ✗ {}", e.getMessage(), e);
            throw new IllegalStateException("Email gateway error", e);
        }
    }

    @Override
    public Delivery sendNotificationEmail(String to, String subject, String text) {
        try {
            return new Delivery(sendEmail(to, subject, text), to);
        } catch (Exception e) {
            log.error("sendNotificationEmail :: ✗ {}", e.getMessage());
            return new Delivery("failed", to);
        }
    }

    @Override
    public Delivery sendWhatsApp(String to, String message) {
        if (twilioSid == null || twilioSid.isBlank() || twilioFrom == null || twilioFrom.isBlank()) {
            log.info("sendWhatsApp :: [DEV WHATSAPP] {}: {}", to, message);
            return new Delivery("console", to);
        }
        try {
            String auth = Base64.getEncoder()
                .encodeToString((twilioSid + ":" + twilioToken).getBytes(StandardCharsets.UTF_8));
            String form = "To=" + enc("whatsapp:" + to)
                + "&From=" + enc("whatsapp:" + twilioFrom)
                + "&Body=" + enc(message);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.twilio.com/2010-04-01/Accounts/"
                    + twilioSid + "/Messages.json"))
                .header("Authorization", "Basic " + auth)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();
            HttpResponse<String> res = HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                throw new IllegalStateException("WhatsApp gateway error: " + res.statusCode());
            }
            return new Delivery("whatsapp", to);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Delivery("failed", to);
        } catch (Exception e) {
            log.error("sendWhatsApp :: ✗ {}", e.getMessage());
            return new Delivery("failed", to);
        }
    }

    /** SMTP send used by notifications; fails soft ("failed") like the Node notifyService. */
    private String sendEmail(String to, String subject, String text) {
        if (smtpHost == null || smtpHost.isBlank()) {
            log.info("sendEmail :: [DEV EMAIL] To: {} | Subject: {}\n{}", to, subject, text);
            return "console";
        }
        try {
            JavaMailSenderImpl sender = new JavaMailSenderImpl();
            sender.setHost(smtpHost);
            sender.setPort(smtpPort);
            if (smtpUser != null && !smtpUser.isBlank()) {
                sender.setUsername(smtpUser);
                sender.setPassword(smtpPass);
            }
            var props = sender.getJavaMailProperties();
            props.put("mail.smtp.auth", smtpUser != null && !smtpUser.isBlank());
            props.put("mail.smtp.starttls.enable", !smtpSecure);
            props.put("mail.smtp.ssl.enable", smtpSecure);

            MimeMessage msg = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg);
            helper.setFrom(mailFrom != null && !mailFrom.isBlank() ? mailFrom : smtpUser);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(text);
            sender.send(msg);
            return "email";
        } catch (Exception e) {
            log.error("sendEmail :: ✗ {}", e.getMessage());
            throw new IllegalStateException("Email gateway error", e);
        }
    }

    @Override
    public String sendSms(String to, String otp) {
        if (twilioSid == null || twilioSid.isBlank()) {
            log.info("sendSms :: [DEV OTP] {}: {}", to, otp);
            return "console";
        }
        try {
            String auth = Base64.getEncoder()
                .encodeToString((twilioSid + ":" + twilioToken).getBytes(StandardCharsets.UTF_8));
            String form = "To=" + enc(to)
                + "&From=" + enc(twilioFrom)
                + "&Body=" + enc("GYM OS: Your password reset OTP is " + otp
                    + ". Valid for " + otpTtlMinutes + " minutes.");
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.twilio.com/2010-04-01/Accounts/"
                    + twilioSid + "/Messages.json"))
                .header("Authorization", "Basic " + auth)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();
            HttpResponse<String> res = HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                throw new IllegalStateException("SMS gateway error: " + res.statusCode());
            }
            return "sms";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("SMS gateway error", e);
        } catch (Exception e) {
            throw new IllegalStateException("SMS gateway error", e);
        }
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }
}
