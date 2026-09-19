package com.gymos.branding.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.PropertySource;

/**
 * This install's gym identity, read from {@code branding.properties}.
 *
 * <p>GYM OS is sold to many gyms, so the gym's own name is configuration, not
 * source. Three layers, each overriding the one before:
 *
 * <ol>
 *   <li>{@code classpath:branding.properties} — bundled in the war</li>
 *   <li>{@code ./branding.properties} — dropped next to the war, so a site can
 *       be rebranded without a rebuild</li>
 *   <li>environment variables ({@code GYM_BRANDING_NAME} and friends)</li>
 * </ol>
 *
 * <p>A gym admin editing branding in the app writes to the settings table, and
 * that wins over all three — these are the starting values, not a lock. See
 * {@link com.gymos.branding.service.impl.BrandingServiceImpl}.
 *
 * <p>The encoding is pinned to UTF-8: {@code .properties} files are read as
 * ISO-8859-1 by default, which would mangle the logo emoji and any accented
 * gym name into mojibake on every screen.
 */
@Configuration
@ConfigurationProperties(prefix = "gym.branding")
@PropertySource(value = "classpath:branding.properties", encoding = "UTF-8")
@PropertySource(value = "file:./branding.properties", encoding = "UTF-8", ignoreResourceNotFound = true)
public class BrandingProperties {

    private String name = "GYM OS";
    private String tagline = "Management System";
    private String logo = "🏋️";
    private String colour = "#059669";
    /** A line of the gym's own on the sign-in screen; blank leaves it off. */
    private String quote = "";
    private String phone = "";
    private String email = "";
    private String address = "";
    private String website = "";
    /** Tax registration, printed on receipts. Blank leaves the line off. */
    private String gstin = "";

    /**
     * The series every tax invoice is numbered in, e.g. INV-2026-0007. Gyms
     * hand their books to an accountant who often wants the gym's own series,
     * and it was a literal in the number generator.
     */
    private String invoicePrefix = "INV";
    /**
     * The gym's own terms under a printed document — refund policy, freeze
     * rules, a thank-you. It appears on both the receipt and the invoice,
     * which share one design, so it must not name either one. Blank leaves
     * the block off entirely.
     */
    private String receiptNote = "";
    private boolean poweredBy = true;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getTagline() {
        return tagline;
    }

    public void setTagline(String tagline) {
        this.tagline = tagline;
    }

    public String getLogo() {
        return logo;
    }

    public void setLogo(String logo) {
        this.logo = logo;
    }

    public String getColour() {
        return colour;
    }

    public void setColour(String colour) {
        this.colour = colour;
    }

    public String getQuote() {
        return quote;
    }

    public void setQuote(String quote) {
        this.quote = quote;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getAddress() {
        return address;
    }

    public void setAddress(String address) {
        this.address = address;
    }

    public String getWebsite() {
        return website;
    }

    public void setWebsite(String website) {
        this.website = website;
    }

    public String getGstin() {
        return gstin;
    }

    public void setGstin(String gstin) {
        this.gstin = gstin;
    }

    public String getInvoicePrefix() {
        return invoicePrefix;
    }

    public void setInvoicePrefix(String invoicePrefix) {
        this.invoicePrefix = invoicePrefix;
    }

    public String getReceiptNote() {
        return receiptNote;
    }

    public void setReceiptNote(String receiptNote) {
        this.receiptNote = receiptNote;
    }

    public boolean isPoweredBy() {
        return poweredBy;
    }

    public void setPoweredBy(boolean poweredBy) {
        this.poweredBy = poweredBy;
    }
}
