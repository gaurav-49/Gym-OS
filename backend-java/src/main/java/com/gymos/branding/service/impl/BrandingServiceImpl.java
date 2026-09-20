package com.gymos.branding.service.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.branding.config.BrandingProperties;
import com.gymos.branding.dao.BrandingDao;
import com.gymos.branding.service.BrandingService;
import com.gymos.common.api.BusinessException;

/**
 * The gym's own name, logo and contact details.
 *
 * <p>The product is sold to many gyms, so nothing gym-facing may be hard-coded:
 * the sidebar, the login screen, the member portal, invoices and reminder
 * messages all read from here. "GYM OS" remains only as the optional
 * "Powered by" line, which a gym can switch off.
 *
 * <p>Two layers. {@code branding.properties} carries the install's identity —
 * that is the file a reseller edits when standing up a new gym. The settings
 * table holds only what an admin has since changed in the app, and wins where
 * it has a value. Nothing gym-facing is hard-coded in either.
 *
 * <p>{@link #get()} is deliberately unauthenticated — the login screen has to
 * show the gym's name before anyone has signed in — so it must never carry
 * anything but public identity.
 */
@Service
public class BrandingServiceImpl implements BrandingService {

    /** The whitelist of what an admin may write, in display order. */
    private static final List<String> ORDER = List.of(
        "name", "tagline", "quote", "logo", "colour",
        "phone", "email", "address", "website", "gstin", "invoice_prefix",
        "receipt_note", "powered_by");

    /** Fields where an empty value means "leave the line off", not "use the default". */
    private static final List<String> OPTIONAL =
        List.of("quote", "phone", "email", "address", "website", "gstin", "receipt_note");

    private static final int MAX_LENGTH = 200;

    private final BrandingDao brandingDao;
    private final BrandingProperties defaults;

    public BrandingServiceImpl(BrandingDao brandingDao, BrandingProperties defaults) {
        this.brandingDao = brandingDao;
        this.defaults = defaults;
    }

    /** The configured value for a field — what shows until an admin changes it. */
    private String configured(String key) {
        return switch (key) {
            case "name" -> defaults.getName();
            case "tagline" -> defaults.getTagline();
            case "quote" -> defaults.getQuote();
            case "logo" -> defaults.getLogo();
            case "colour" -> defaults.getColour();
            case "phone" -> defaults.getPhone();
            case "email" -> defaults.getEmail();
            case "address" -> defaults.getAddress();
            case "website" -> defaults.getWebsite();
            case "gstin" -> defaults.getGstin();
            case "invoice_prefix" -> defaults.getInvoicePrefix();
            case "receipt_note" -> defaults.getReceiptNote();
            case "powered_by" -> String.valueOf(defaults.isPoweredBy());
            default -> "";
        };
    }

    @Override
    public Map<String, Object> get() {
        Map<String, String> stored = brandingDao.load();
        Map<String, Object> out = new LinkedHashMap<>();
        for (String key : ORDER) {
            String value = stored.get(key);
            // Nothing stored (or stored blank) falls back to branding.properties.
            // A blank name would leave every screen unlabelled, so only the
            // genuinely optional contact fields are allowed to render as "".
            if (value == null || (value.isBlank() && !OPTIONAL.contains(key))) {
                value = configured(key);
            }
            out.put(key, value == null ? "" : value);
        }
        out.put("powered_by", !"false".equalsIgnoreCase(String.valueOf(out.get("powered_by"))));
        // Not one of the admin-editable ORDER fields: whether the Branding
        // page/nav item shows at all is a per-install feature flag set
        // directly in the settings table (default 'N'; see migrate.js), not
        // something a gym's own admin can turn on from inside the app.
        out.put("branding_enabled", "Y".equalsIgnoreCase(brandingDao.loadSetting("feature_branding_ui")));
        return out;
    }

    @Override
    public String invoicePrefix() {
        Object value = get().get("invoice_prefix");
        String prefix = value == null ? "" : String.valueOf(value).trim();
        // Never empty: the number would start with a bare "-" and the "highest
        // this year" lookup would match every series at once.
        return prefix.isEmpty() ? "INV" : prefix;
    }

    @Override
    public Map<String, Object> update(Map<String, Object> body) {
        if (body == null || body.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Nothing to update.");
        }
        for (Map.Entry<String, Object> entry : body.entrySet()) {
            String key = entry.getKey();
            if (!ORDER.contains(key)) {
                // Explicit whitelist: this writes into the shared settings
                // table, which also holds reminder and billing configuration.
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "\"" + key + "\" is not a branding field.");
            }
            String value = entry.getValue() == null ? "" : String.valueOf(entry.getValue()).trim();
            if (value.length() > MAX_LENGTH) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "\"" + key + "\" is too long (max " + MAX_LENGTH + " characters).");
            }
            if ("name".equals(key) && value.isEmpty()) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "The gym name cannot be blank — it labels every screen.");
            }
            if ("colour".equals(key) && !value.isEmpty() && !value.matches("#[0-9a-fA-F]{6}")) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "Colour must be a hex value like #059669.");
            }
            // The prefix becomes part of invoice_no, which is 30 characters and
            // read back by an accountant. Letters, digits and the separators
            // books actually use — nothing that could break the number apart.
            if ("invoice_prefix".equals(key)) {
                if (value.isEmpty()) {
                    throw new BusinessException(HttpStatus.BAD_REQUEST,
                        "The invoice series cannot be blank — it prefixes every invoice number.");
                }
                if (!value.matches("[A-Za-z0-9/_-]{1,12}")) {
                    throw new BusinessException(HttpStatus.BAD_REQUEST,
                        "The invoice series may use letters, digits, / _ and - (max 12 characters).");
                }
            }
            brandingDao.save(key, value);
        }
        return get();
    }
}
