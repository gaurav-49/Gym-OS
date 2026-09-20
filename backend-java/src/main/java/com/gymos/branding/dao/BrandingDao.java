package com.gymos.branding.dao;

import java.util.Map;

/** Branding is stored as rows in the shared key/value {@code settings} table. */
public interface BrandingDao {

    /** @return every {@code brand_*} setting, keyed without the prefix */
    Map<String, String> load();

    /** Upsert one branding field. */
    void save(String key, String value);

    /**
     * A plain (non-{@code brand_}-prefixed) settings row, e.g. the
     * {@code feature_branding_ui} flag that gates the whole customization UI
     * per install. {@code null} if the key has never been set.
     */
    String loadSetting(String key);
}
